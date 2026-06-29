/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/services/pos_store";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { formatCurrency } from "@web/core/currency";

function _getPartnerEWalletBalanceUCS(pos, partner) {
    if (!partner) return 0;
    let balance = 0;
    const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partner.id];
    if (couponIds) {
        for (const couponId of couponIds) {
            const loyaltyCardModel = pos.models && pos.models["loyalty.card"];
            if (!loyaltyCardModel) continue;
            const coupon = loyaltyCardModel.get(couponId);
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
    if (!order) return false;
    if (order.priceIncl >= 0) return false;
    for (const line of order.getOrderlines()) {
        const product = line.product_id;
        if (!product) continue;
        const loyaltyProgramModel = pos.models && pos.models["loyalty.program"];
        if (!loyaltyProgramModel) continue;
        const linkedPrograms = (
            loyaltyProgramModel.getBy("trigger_product_ids", product.id) || []
        ).filter((p) => p.program_type === "ewallet");
        if (linkedPrograms.length > 0) return true;
    }
    return false;
}

patch(PosStore.prototype, {
    async pay() {
        const order = this.getOrder();
        if (!order) {
            return super.pay(...arguments);
        }

        if (order.priceIncl < 0) {
            const isTopUpRefund = _isEWalletTopUpRefundOrder(this, order);
            if (isTopUpRefund) {
                const partner = order.getPartner();
                const eWalletBalance = _getPartnerEWalletBalanceUCS(this, partner);
                const refundAmount = Math.abs(order.priceIncl);

                if (refundAmount > eWalletBalance) {
                    this.dialog.add(AlertDialog, {
                        title: _t("Insufficient eWallet Balance"),
                        body: _t(
                            "Refund amount (%s) exceeds eWallet balance (%s).",
                            formatCurrency(refundAmount, order.currency.id),
                            formatCurrency(eWalletBalance, order.currency.id)
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
        const order = this.pos.getOrder();
        let topUpRefundPartner = null;
        const deductionPerProgram = {};

        if (_isEWalletTopUpRefundOrder(this.pos, order)) {
            topUpRefundPartner = order.getPartner();
            
            const eWalletBalance = _getPartnerEWalletBalanceUCS(this.pos, topUpRefundPartner);
            const refundAmount = Math.abs(order.priceIncl);
            
            if (refundAmount > eWalletBalance) {
                this.dialog.add(AlertDialog, {
                    title: _t("Insufficient eWallet Balance"),
                    body: _t(
                        "Refund amount (%s) exceeds eWallet balance (%s).",
                        formatCurrency(refundAmount, order.currency.id),
                        formatCurrency(eWalletBalance, order.currency.id)
                    ),
                });
                return; // Block validation
            }

            for (const line of order.getOrderlines()) {
                if (line.priceIncl >= 0) continue;
                const product = line.product_id;
                if (!product) continue;
                const loyaltyProgramModel = this.pos.models && this.pos.models["loyalty.program"];
                if (!loyaltyProgramModel) continue;
                const linkedPrograms = (
                    loyaltyProgramModel.getBy("trigger_product_ids", product.id) || []
                ).filter((p) => p.program_type === "ewallet");
                for (const prog of linkedPrograms) {
                    const amount = Math.abs(line.priceIncl);
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
                const loyaltyCardModel = this.pos.models && this.pos.models["loyalty.card"];
                if (!loyaltyCardModel) continue;
                const coupon = loyaltyCardModel.get(couponId);
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