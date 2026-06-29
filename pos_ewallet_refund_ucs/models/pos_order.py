# -*- coding: utf-8 -*-
from odoo import models, fields, api


class PosOrderUCS(models.Model):
    _inherit = 'pos.order'

    ucs_ewallet_refund_deducted = fields.Boolean("EWallet Refund Deducted", default=False)

    # In Odoo 19, native loyalty handles points deduction and negated values for refunds accurately.
    # The following legacy overrides from v17/v18 cause double-deductions and negative balance bugs in v19.
    
    @api.model
    def _process_order(self, order, existing_order):
        order_id = super()._process_order(order, existing_order)
        if order_id:
            self.ucs_deduct_ewallet_for_refund(order_id)
        return order_id

    # def confirm_coupon_programs(self, coupon_data):
    #     ... (Legacy v18 negation logic removed for v19) ...
    #     return super().confirm_coupon_programs(coupon_data)

    @api.model
    def ucs_deduct_ewallet_for_refund(self, order_id):
        order = self.browse(order_id)
        if not order.exists() or not order.partner_id:
            return False
        if order.amount_total >= 0:
            return False
        if order.ucs_ewallet_refund_deducted:
            return False

        ewallet_programs = self.env['loyalty.program'].search([
            ('program_type', '=', 'ewallet'),
            ('active', '=', True),
        ])
        product_to_program = {}
        for prog in ewallet_programs:
            for product in prog.trigger_product_ids:
                product_to_program[product.id] = prog

        if not product_to_program:
            return False

        deduction_per_program = {}
        for line in order.lines:
            # FIX: Check line.qty * line.price_unit for refund lines, as Odoo 19 keeps price_subtotal_incl positive
            if line.qty * line.price_unit >= 0:
                continue
            prog = product_to_program.get(line.product_id.id)
            if not prog:
                continue
            amount = abs(line.price_subtotal_incl)
            if amount > 0:
                deduction_per_program.setdefault(prog.id, 0)
                deduction_per_program[prog.id] += amount

        if not deduction_per_program:
            return False

        results = {}
        for program_id, deduct in deduction_per_program.items():
            card = self.env['loyalty.card'].search([
                ('partner_id', '=', order.partner_id.id),
                ('program_id', '=', program_id),
            ], limit=1, order='id desc')
            if card:
                new_balance = max(0.0, card.points - deduct)
                card.sudo().write({'points': new_balance})
                
                # Add history line for transparency in the backend
                self.env['loyalty.history'].sudo().create({
                    'card_id': card.id,
                    'order_model': 'pos.order',
                    'order_id': order.id,
                    'description': f'Refund Top-up ({order.name})',
                    'used': deduct,
                    'issued': 0.0,
                })
                
                results[program_id] = new_balance

        if results:
            order.sudo().write({'ucs_ewallet_refund_deducted': True})

        return results or False
