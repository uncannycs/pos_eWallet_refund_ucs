from odoo.tests import tagged, TransactionCase

@tagged('-at_install', 'post_install')
class TestPosEwalletRefund(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env = cls.env(context=dict(cls.env.context, tracking_disable=True))
        
        cls.partner = cls.env['res.partner'].create({'name': 'Test EWallet Customer'})
        
        cls.ewallet_product = cls.env['product.product'].create({
            'name': 'Top-up eWallet',
            'type': 'service',
            'available_in_pos': True,
        })
        
        cls.ewallet_program = cls.env['loyalty.program'].create({
            'name': 'eWallet Program',
            'program_type': 'ewallet',
            'trigger': 'auto',
            'applies_on': 'future',
            'reward_ids': [(0, 0, {
                'reward_type': 'discount',
                'discount_mode': 'per_point',
                'discount': 1,
            })],
            'rule_ids': [(0, 0, {
                'reward_point_amount': 1,
                'reward_point_mode': 'money',
                'product_ids': [(6, 0, [cls.ewallet_product.id])],
            })],
        })
        
        cls.pos_config = cls.env['pos.config'].create({
            'name': 'Test POS Config',
            'module_pos_discount': False,
        })
        cls.pos_session = cls.env['pos.session'].create({
            'config_id': cls.pos_config.id,
            'user_id': cls.env.uid,
        })

    def test_ucs_deduct_ewallet_for_refund(self):
        """Test that refunding a top-up product reduces the eWallet balance."""
        
        # 1. Give the customer an eWallet card with $100
        card = self.env['loyalty.card'].create({
            'program_id': self.ewallet_program.id,
            'partner_id': self.partner.id,
            'points': 100.0,
        })
        
        # 2. Create a POS order simulating a $50 top-up refund
        # qty is -1, price_unit is 50. Odoo 19 keeps price_subtotal_incl positive.
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        
        # 3. Call the deduction method
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        
        # 4. Verify the result
        self.assertTrue(result, "Method should return a result dict")
        self.assertIn(self.ewallet_program.id, result)
        self.assertEqual(result[self.ewallet_program.id], 50.0)
        
        # 5. Verify the card points
        card.invalidate_recordset(['points'])
        self.assertEqual(card.points, 50.0, "Card points should be deducted by $50")
        
        # 6. Verify the history line
        history = self.env['loyalty.history'].search([
            ('card_id', '=', card.id),
            ('order_id', '=', order.id),
            ('order_model', '=', 'pos.order'),
        ])
        self.assertEqual(len(history), 1, "A history line should be created")
        self.assertEqual(history.used, 50.0)
        self.assertEqual(history.issued, 0.0)

    def test_ucs_deduct_ewallet_ignores_positive_orders(self):
        """Test that a positive order (regular sale or top-up) does not deduct points."""
        
        card = self.env['loyalty.card'].create({
            'program_id': self.ewallet_program.id,
            'partner_id': self.partner.id,
            'points': 100.0,
        })
        
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': 50.0,
            'amount_paid': 50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': 1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertFalse(result, "Method should return False for positive amount_total")
        
        card.invalidate_recordset(['points'])
        self.assertEqual(card.points, 100.0, "Card points should remain unchanged")

    def test_process_order_triggers_deduction(self):
        """Test that _process_order triggers ucs_deduct_ewallet_for_refund."""
        order_dict = {
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [[0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
                'tax_ids': [[6, False, []]],
                'pack_lot_ids': [],
            }]],
            'name': 'Test Order 1',
        }
        
        card = self.env['loyalty.card'].create({
            'program_id': self.ewallet_program.id,
            'partner_id': self.partner.id,
            'points': 100.0,
        })
        
        order_id = self.env['pos.order']._process_order(order_dict, False)
        
        card.invalidate_recordset(['points'])
        self.assertEqual(card.points, 50.0, "Points should be deducted via _process_order")

    def test_ucs_deduct_ewallet_missing_partner(self):
        """Test early exit when partner is missing."""
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': False,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertFalse(result)

    def test_ucs_deduct_ewallet_missing_order(self):
        """Test early exit when order does not exist."""
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(9999999)
        self.assertFalse(result)

    def test_ucs_deduct_ewallet_already_deducted(self):
        """Test early exit when already deducted."""
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'ucs_ewallet_refund_deducted': True,
            'lines': [(0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertFalse(result)

    def test_ucs_deduct_ewallet_no_programs(self):
        """Test early exit when no ewallet programs exist."""
        self.ewallet_program.active = False
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': self.ewallet_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertFalse(result)
        self.ewallet_program.active = True

    def test_ucs_deduct_ewallet_mixed_lines(self):
        """Test that only refund lines are processed."""
        card = self.env['loyalty.card'].create({
            'program_id': self.ewallet_program.id,
            'partner_id': self.partner.id,
            'points': 100.0,
        })
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -20.0,
            'amount_paid': -20.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [
                (0, 0, {
                    'product_id': self.ewallet_product.id,
                    'qty': -1.0,
                    'price_unit': 50.0,
                    'price_subtotal': 50.0,
                    'price_subtotal_incl': 50.0,
                }),
                (0, 0, {
                    'product_id': self.ewallet_product.id,
                    'qty': 1.0,
                    'price_unit': 30.0,
                    'price_subtotal': 30.0,
                    'price_subtotal_incl': 30.0,
                })
            ]
        })
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertEqual(result[self.ewallet_program.id], 50.0)

    def test_ucs_deduct_ewallet_unrelated_product(self):
        """Test early exit when product is not an ewallet trigger."""
        other_product = self.env['product.product'].create({'name': 'T-Shirt', 'available_in_pos': True})
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'partner_id': self.partner.id,
            'amount_total': -50.0,
            'amount_paid': -50.0,
            'amount_tax': 0.0,
            'amount_return': 0.0,
            'lines': [(0, 0, {
                'product_id': other_product.id,
                'qty': -1.0,
                'price_unit': 50.0,
                'price_subtotal': 50.0,
                'price_subtotal_incl': 50.0,
            })]
        })
        result = self.env['pos.order'].ucs_deduct_ewallet_for_refund(order.id)
        self.assertFalse(result)

