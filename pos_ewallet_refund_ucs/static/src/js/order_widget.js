/** @odoo-module **/

import { OrderWidget } from "@point_of_sale/app/generic_components/order_widget/order_widget";
import { patch } from "@web/core/utils/patch";
import { useState, onMounted, onWillRender } from "@odoo/owl";

patch(OrderWidget.prototype, {
    setup() {
        super.setup(...arguments);
        this.ucsState = useState({
            ewalletBalance: "",
            currentPartnerId: null,
        });

        // Use onWillRender to detect partner changes and trigger fetches
        // outside of the render cycle.
        onMounted(() => {
            this._ucsCheckAndFetchEWallet();
        });
        onWillRender(() => {
            this._ucsCheckAndFetchEWallet();
        });
    },

    /**
     * Detect if the current order's partner changed and fetch eWallet
     * coupons if needed. Updates reactive state which triggers re-render.
     */
    _ucsCheckAndFetchEWallet() {
        const pos = this.env.services && this.env.services.pos;
        if (!pos) return;

        const order = pos.get_order();
        const partner = order && order.get_partner();
        const partnerId = partner ? partner.id : null;

        if (partnerId !== this.ucsState.currentPartnerId) {
            // Partner changed — update tracking and fetch coupons
            this.ucsState.currentPartnerId = partnerId;

            if (partnerId) {
                // Compute balance from existing cache first
                this.ucsState.ewalletBalance = this._ucsComputeBalance(pos, partnerId);

                // Then fetch fresh data from server and update
                pos.fetchCoupons(
                    [["partner_id", "=", partnerId]],
                    100
                ).then(() => {
                    this.ucsState.ewalletBalance = this._ucsComputeBalance(pos, partnerId);
                }).catch(() => {
                    // If fetch fails, keep whatever we had from cache
                });
            } else {
                this.ucsState.ewalletBalance = "";
            }
        }
    },

    /**
     * Compute the eWallet balance for a partner from the coupon cache.
     */
    _ucsComputeBalance(pos, partnerId) {
        const couponIds = pos.partnerId2CouponIds && pos.partnerId2CouponIds[partnerId];
        if (!couponIds) return "";

        let totalBalance = 0;
        let hasEWallet = false;

        for (const couponId of couponIds) {
            const coupon = pos.couponCache[couponId];
            if (!coupon) continue;
            const program = pos.program_by_id[coupon.program_id];
            if (program && program.program_type === "ewallet") {
                totalBalance += coupon.balance;
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

    /**
     * Called from the template to get the eWallet balance display string.
     */
    getEWalletBalanceUCS() {
        // Touch reactive state so Owl tracks it as a dependency
        return this.ucsState.ewalletBalance;
    },
});
