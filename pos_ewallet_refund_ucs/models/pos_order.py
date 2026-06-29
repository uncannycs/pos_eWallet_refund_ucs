# -*- coding: utf-8 -*-
from odoo import models, fields, api


class PosOrderUCS(models.Model):
    _inherit = 'pos.order'

    ucs_ewallet_refund_deducted = fields.Boolean("EWallet Refund Deducted", default=False)

    @api.model
    def _process_order(self, order, existing_order):
        order_id = super()._process_order(order, existing_order)
        if order_id:
            self.ucs_deduct_ewallet_for_refund(order_id)
        return order_id

    def confirm_coupon_programs(self, coupon_data):
        ewallet_programs = self.env['loyalty.program'].search([
            ('program_type', '=', 'ewallet'),
            ('active', '=', True),
        ])

        ewallet_program_product_map = {}
        for prog in ewallet_programs:
            ewallet_program_product_map[prog.id] = set(prog.trigger_product_ids.ids)

        if ewallet_program_product_map:
            for order in self:
                programs_to_negate = set()
                for line in order.lines:
                    if line.price_subtotal_incl >= 0:
                        continue
                    for prog_id, product_ids in ewallet_program_product_map.items():
                        if line.product_id.id in product_ids:
                            programs_to_negate.add(prog_id)

                if not programs_to_negate:
                    continue

                for coupon_key, coupon_vals in coupon_data.items():
                    prog_id = coupon_vals.get('program_id')
                    if prog_id in programs_to_negate:
                        original_points = coupon_vals.get('points', 0)
                        if original_points > 0:
                            coupon_vals['points'] = -original_points

        return super().confirm_coupon_programs(coupon_data)

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
                results[program_id] = new_balance

        if results:
            order.sudo().write({'ucs_ewallet_refund_deducted': True})

        return results or False
