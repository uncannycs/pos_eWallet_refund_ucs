/** @odoo-module **/

import { OrderDisplay } from "@point_of_sale/app/components/order_display/order_display";
import { patch } from "@web/core/utils/patch";

patch(OrderDisplay.prototype, {

    getEWalletBalanceUCS() {
        try {
            const pos = this.env?.services?.pos;
            if (!pos) return "";

            const order = this.order;
            if (!order || typeof order.getPartner !== 'function') return "";
            
            const partner = order.getPartner();
            if (!partner) return "";

            const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partner.id];
            if (!couponIds) return "";

            let totalBalance = 0;
            let hasEWallet = false;

            for (const couponId of couponIds) {
                const loyaltyCardModel = pos.models && pos.models["loyalty.card"];
                if (!loyaltyCardModel) continue;
                const coupon = loyaltyCardModel.get(couponId);
                if (!coupon) continue;
                const program = coupon.program_id;
                if (program && program.program_type === "ewallet") {
                    totalBalance += coupon.points;
                    hasEWallet = true;
                }
            }

            if (hasEWallet) {
                if (typeof this.formatCurrency === 'function' && this.order?.currency?.id) {
                    return this.formatCurrency(totalBalance);
                } else if (pos.env?.utils?.formatCurrency) {
                    return pos.env.utils.formatCurrency(totalBalance);
                }
                return totalBalance;
            }
            return "";
        } catch (error) {
            console.warn("Error in getEWalletBalanceUCS:", error);
            return "";
        }
    },
});
