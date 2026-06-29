/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

patch(PosStore.prototype, {
    /**
     * Override load_orders to filter out eWallet top-up orders that were
     * saved in local storage from previous sessions. This ensures the POS
     * always opens with a fresh, empty order screen.
     */
    async load_orders() {
        await super.load_orders(...arguments);
        // After standard loading, remove any eWallet orders that are
        // lingering from local storage (previous sessions / abandoned orders).
        this._ucsRemoveStaleEWalletOrders();
    },

    /**
     * Remove all eWallet top-up orders (both positive and refund) from the
     * loaded order list. These are stale orders persisted in IndexedDB
     * from previous sessions. After removing, the standard set_start_order()
     * will create a fresh empty order.
     */
    _ucsRemoveStaleEWalletOrders() {
        const ordersToRemove = [];

        for (const order of [...this.get_order_list()]) {
            // Only remove orders that are NOT finalized (i.e. not already validated/paid)
            if (order.finalized) {
                continue;
            }
            // Check if it's an empty order (no lines) or if it has eWallet product lines
            if (order.get_orderlines().length === 0 || this._ucsIsEWalletOrder(order)) {
                ordersToRemove.push(order);
            }
        }

        for (const order of ordersToRemove) {
            this.removeOrder(order, false);
        }
    },

    /**
     * Check if an order contains eWallet top-up product lines.
     */
    _ucsIsEWalletOrder(order) {
        if (!this.productId2ProgramIds) {
            return false;
        }
        for (const line of order.get_orderlines()) {
            const programIds = this.productId2ProgramIds[line.product.id];
            if (!programIds) continue;
            for (const progId of programIds) {
                const prog = this.program_by_id[progId];
                if (prog && prog.program_type === "ewallet") {
                    return true;
                }
            }
        }
        return false;
    },
});
