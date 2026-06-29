/** @odoo-module **/

import { Order } from "@point_of_sale/app/store/models";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { _t } from "@web/core/l10n/translation";

// ─── Utility function to get eWallet balance ───────────────────────────────────
function _getPartnerEWalletBalanceUCS(pos, partner) {
    if (!partner) return 0;
    let balance = 0;
    const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partner.id];
    if (couponIds) {
        for (const couponId of couponIds) {
            const coupon = pos.couponCache[couponId];
            if (!coupon) continue;
            const prog = pos.program_by_id[coupon.program_id];
            if (prog && prog.program_type === "ewallet") {
                balance += coupon.balance;
            }
        }
    }
    return balance;
}

// ─── Utility function to check if order is eWallet top-up refund ─────────────
function _isEWalletTopUpRefundOrder(pos, order) {
    if (order.get_total_with_tax() >= 0) return false;
    for (const line of order.get_orderlines()) {
        const programIds = pos.productId2ProgramIds && pos.productId2ProgramIds[line.product.id];
        if (!programIds) continue;
        for (const progId of programIds) {
            const prog = pos.program_by_id[progId];
            if (prog && prog.program_type === "ewallet") return true;
        }
    }
    return false;
}

// ─── Patch 1: Order — show error when clicking Payment button ─────────────────
patch(Order.prototype, {
    async pay() {
        // Only check on refund orders (total is negative)
        if (this.get_total_with_tax() < 0) {
            const isTopUpRefund = _isEWalletTopUpRefundOrder(this.pos, this);
            if (isTopUpRefund) {
                const partner = this.get_partner();
                const eWalletBalance = _getPartnerEWalletBalanceUCS(this.pos, partner);
                const refundAmount = Math.abs(this.get_total_with_tax());

                if (refundAmount > eWalletBalance) {
                    this.env.services.popup.add(ErrorPopup, {
                        title: _t("Insufficient eWallet Balance"),
                        body: _t(
                            "Refund amount (%s) exceeds eWallet balance (%s).",
                            this.env.utils.formatCurrency(refundAmount),
                            this.env.utils.formatCurrency(eWalletBalance)
                        ),
                    });
                    return; // Stay on order screen, do not go to payment
                }
            }
        }

        return super.pay(...arguments);
    },
});

// ─── Patch 2: PaymentScreen — deduct eWallet points after validate ────────────
patch(PaymentScreen.prototype, {
    async validateOrder(isForceValidate) {
        const order = this.pos.get_order();

        // Capture context BEFORE super (order may clear after)
        let topUpRefundPartner = null;
        const deductionPerProgram = {};

        if (_isEWalletTopUpRefundOrder(this.pos, order)) {
            topUpRefundPartner = order.get_partner();
            for (const line of order.get_orderlines()) {
                if (line.get_price_with_tax() >= 0) continue;
                const programIds = this.pos.productId2ProgramIds && this.pos.productId2ProgramIds[line.product.id];
                if (!programIds) continue;
                for (const progId of programIds) {
                    const prog = this.pos.program_by_id[progId];
                    if (prog && prog.program_type === "ewallet") {
                        const amount = Math.abs(line.get_price_with_tax());
                        deductionPerProgram[prog.id] = (deductionPerProgram[prog.id] || 0) + amount;
                    }
                }
            }
        }

        // Standard Odoo validation + push
        await super.validateOrder(...arguments);

        // Deduct points locally regardless of server_id
        if (topUpRefundPartner) {
            this._ucsDeductEWalletPointsLocally(topUpRefundPartner, deductionPerProgram);
        }
    },

    /**
     * Updates the local cache to deduct eWallet points immediately.
     */
    _ucsDeductEWalletPointsLocally(partner, deductionPerProgram) {
        if (!partner) return;
        const couponIds = this.pos.partnerId2CouponIds && this.pos.partnerId2CouponIds[partner.id];
        if (couponIds) {
            for (const couponId of couponIds) {
                const coupon = this.pos.couponCache[couponId];
                if (!coupon) continue;
                const prog = this.pos.program_by_id[coupon.program_id];
                if (prog && prog.program_type === "ewallet" && deductionPerProgram[prog.id]) {
                    coupon.balance = Math.max(0, coupon.balance - deductionPerProgram[prog.id]);
                }
            }
        }
    }
});