# -*- coding: utf-8 -*-
from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)


class PosOrderUCS(models.Model):
    _inherit = 'pos.order'

    ucs_ewallet_refund_deducted = fields.Boolean("EWallet Refund Deducted", default=False)

    def _get_fields_for_order_line(self):
        fields = super()._get_fields_for_order_line()
        if 'refunded_orderline_id' not in fields:
            fields.append('refunded_orderline_id')
        return fields

    @api.model
    def _process_order(self, order, draft, existing_order):
        order_id = super()._process_order(order, draft, existing_order)
        if order_id:
            self.ucs_deduct_ewallet_for_refund(order_id)
        return order_id

    def confirm_coupon_programs(self, coupon_data):
        """
        Override to fix eWallet points for refund orders.
        """
        _logger.info(
            "UCS confirm_coupon_programs called: orders=%s coupon_data=%s",
            self.ids, coupon_data
        )
        # Find all eWallet programs and their top-up product IDs
        ewallet_programs = self.env['loyalty.program'].search([
            ('program_type', '=', 'ewallet'),
            ('active', '=', True),
        ])

        ewallet_program_product_map = {}
        for prog in ewallet_programs:
            ewallet_program_product_map[prog.id] = set(
                prog.trigger_product_ids.ids
            )

        if ewallet_program_product_map:
            for order in self:
                _logger.info(
                    "UCS order %s amount_total=%s lines=%s",
                    order.id, order.amount_total,
                    [(l.product_id.name, l.price_subtotal_incl) for l in order.lines]
                )
                # Check all lines — if price is negative it's a refund line
                programs_to_negate = set()
                for line in order.lines:
                    if line.price_subtotal_incl >= 0:
                        continue  # Only process negative-price lines
                    for prog_id, product_ids in ewallet_program_product_map.items():
                        if line.product_id.id in product_ids:
                            programs_to_negate.add(prog_id)

                if not programs_to_negate:
                    continue

                _logger.info("UCS programs to negate: %s", programs_to_negate)
                _logger.info("UCS coupon_data before: %s", coupon_data)

                for coupon_key, coupon_vals in coupon_data.items():
                    prog_id = coupon_vals.get('program_id')
                    if prog_id in programs_to_negate:
                        original_points = coupon_vals.get('points', 0)
                        if original_points > 0:
                            coupon_vals['points'] = -original_points
                            _logger.info(
                                "UCS: Flipped points: %s -> %s",
                                original_points, coupon_vals['points']
                            )

        return super().confirm_coupon_programs(coupon_data)


    @api.model
    def ucs_deduct_ewallet_for_refund(self, order_id):
        """
        Fallback: direct deduction via RPC if confirm_coupon_programs
        was not called (e.g. coupon_data was empty for this order).
        """
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
                _logger.info(
                    "UCS fallback deduct: partner=%s card=%s "
                    "old=%.2f deduct=%.2f new=%.2f",
                    order.partner_id.name, card.id,
                    card.points, deduct, new_balance
                )
                card.sudo().write({'points': new_balance})
                results[program_id] = new_balance

        if results:
            order.sudo().write({'ucs_ewallet_refund_deducted': True})

        return results or False
