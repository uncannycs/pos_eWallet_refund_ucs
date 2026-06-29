/** @odoo-module **/

import { OrderWidget } from "@point_of_sale/app/generic_components/order_widget/order_widget";
import { patch } from "@web/core/utils/patch";
import { useState, onMounted, onWillRender } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";

patch(OrderWidget.prototype, {
    setup() {
        super.setup(...arguments);
        this.pos = usePos();
        this.ucsState = useState({
            ewalletBalance: "",
            currentPartnerId: null,
        });

        onMounted(() => {
            this._ucsCheckAndFetchEWallet();
        });
        onWillRender(() => {
            this._ucsCheckAndFetchEWallet();
        });
    },

    _ucsCheckAndFetchEWallet() {
        const pos = this.pos;
        if (!pos) return;

        const order = pos.get_order();
        const partner = order && order.get_partner();
        const partnerId = partner ? partner.id : null;

        if (partnerId !== this.ucsState.currentPartnerId) {
            this.ucsState.currentPartnerId = partnerId;

            if (partnerId) {
                this.ucsState.ewalletBalance = this._ucsComputeBalance(pos, partnerId);

                pos.fetchCoupons(
                    [["partner_id", "=", partnerId]],
                    100
                ).then(() => {
                    this.ucsState.ewalletBalance = this._ucsComputeBalance(pos, partnerId);
                }).catch(() => {});
            } else {
                this.ucsState.ewalletBalance = "";
            }
        }
    },

    _ucsComputeBalance(pos, partnerId) {
        const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partnerId];
        if (!couponIds) return "";

        let totalBalance = 0;
        let hasEWallet = false;

        for (const couponId of couponIds) {
            const coupon = pos.models["loyalty.card"].get(couponId);
            if (!coupon) continue;
            const program = coupon.program_id;
            if (program && program.program_type === "ewallet") {
                totalBalance += coupon.points;
                hasEWallet = true;
            }
        }

        if (hasEWallet) {
            return this.env.utils
                ? this.env.utils.formatCurrency(totalBalance)
                : totalBalance;
        }
        return "";
    },

    getEWalletBalanceUCS() {
        return this.ucsState.ewalletBalance;
    },
});
