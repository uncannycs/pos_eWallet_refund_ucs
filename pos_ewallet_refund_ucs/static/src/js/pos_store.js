/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

patch(PosStore.prototype, {
    async initServerData() {
        await super.initServerData(...arguments);
        this._ucsRemoveStaleEWalletOrders();
    },

    _ucsRemoveStaleEWalletOrders() {
        const ordersToRemove = [];

        for (const order of this.models["pos.order"].getAll()) {
            if (order.finalized) {
                continue;
            }
            if (order.get_orderlines().length === 0 || this._ucsIsEWalletOrder(order)) {
                ordersToRemove.push(order);
            }
        }

        for (const order of ordersToRemove) {
            this.removeOrder(order, false);
        }
    },

    _ucsIsEWalletOrder(order) {
        for (const line of order.get_orderlines()) {
            const product = line.product_id;
            if (!product) continue;
            const linkedPrograms = (
                this.models["loyalty.program"].getBy("trigger_product_ids", product.id) || []
            ).filter((p) => p.program_type === "ewallet");
            if (linkedPrograms.length > 0) {
                return true;
            }
        }
        return false;
    },
});
