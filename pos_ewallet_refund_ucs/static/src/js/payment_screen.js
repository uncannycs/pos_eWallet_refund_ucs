/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";

function _getPartnerEWalletBalanceUCS(pos, partner) {
    if (!partner) return 0;
    let balance = 0;
    const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partner.id];
    if (couponIds) {
        for (const couponId of couponIds) {
            const coupon = pos.models["loyalty.card"].get(couponId);
            if (!coupon) continue;
            const prog = coupon.program_id;
            if (prog && prog.program_type === "ewallet") {
                balance += coupon.points;
            }
        }
    }
    return balance;
}

function _isEWalletTopUpRefundOrder(pos, order) {
    if (order.get_total_with_tax() >= 0) return false;
    for (const line of order.get_orderlines()) {
        const product = line.product_id;
        if (!product) continue;
        const linkedPrograms = (
            pos.models["loyalty.program"].getBy("trigger_product_ids", product.id) || []
        ).filter((p) => p.program_type === "ewallet");
        if (linkedPrograms.length > 0) return true;
    }
    return false;
}

patch(PosStore.prototype, {
    async pay() {
        const order = this.get_order();
        if (!order) {
            return super.pay(...arguments);
        }

        if (order.get_total_with_tax() < 0) {
            const isTopUpRefund = _isEWalletTopUpRefundOrder(this, order);
            if (isTopUpRefund) {
                const partner = order.get_partner();
                const eWalletBalance = _getPartnerEWalletBalanceUCS(this, partner);
                const refundAmount = Math.abs(order.get_total_with_tax());

                if (refundAmount > eWalletBalance) {
                    this.env.services.dialog.add(AlertDialog, {
                        title: _t("Insufficient eWallet Balance"),
                        body: _t(
                            "Refund amount (%s) exceeds eWallet balance (%s).",
                            this.env.utils.formatCurrency(refundAmount),
                            this.env.utils.formatCurrency(eWalletBalance)
                        ),
                    });
                    return;
                }
            }
        }

        return super.pay(...arguments);
    },
});

patch(PaymentScreen.prototype, {
    async validateOrder(isForceValidate) {
        const order = this.pos.get_order();
        let topUpRefundPartner = null;
        const deductionPerProgram = {};

        if (_isEWalletTopUpRefundOrder(this.pos, order)) {
            topUpRefundPartner = order.get_partner();
            for (const line of order.get_orderlines()) {
                if (line.get_price_with_tax() >= 0) continue;
                const product = line.product_id;
                if (!product) continue;
                const linkedPrograms = (
                    this.pos.models["loyalty.program"].getBy("trigger_product_ids", product.id) || []
                ).filter((p) => p.program_type === "ewallet");
                for (const prog of linkedPrograms) {
                    const amount = Math.abs(line.get_price_with_tax());
                    deductionPerProgram[prog.id] = (deductionPerProgram[prog.id] || 0) + amount;
                }
            }
        }

        await super.validateOrder(...arguments);

        if (topUpRefundPartner) {
            this._ucsDeductEWalletPointsLocally(topUpRefundPartner, deductionPerProgram);
        }
    },

    _ucsDeductEWalletPointsLocally(partner, deductionPerProgram) {
        if (!partner) return;
        const couponIds = this.pos.partnerId2CouponIds && this.pos.partnerId2CouponIds[partner.id];
        if (couponIds) {
            for (const couponId of couponIds) {
                const coupon = this.pos.models["loyalty.card"].get(couponId);
                if (!coupon) continue;
                const prog = coupon.program_id;
                if (prog && prog.program_type === "ewallet" && deductionPerProgram[prog.id]) {
                    coupon.update({
                        points: Math.max(0, coupon.points - deductionPerProgram[prog.id]),
                    });
                }
            }
        }
    },
});