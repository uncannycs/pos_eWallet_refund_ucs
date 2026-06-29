/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/services/pos_store";
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
            if (order.getOrderlines().length === 0 || this._ucsIsEWalletOrder(order)) {
                ordersToRemove.push(order);
            }
        }

        for (const order of ordersToRemove) {
            this.removeOrder(order, false);
        }
    },

    _ucsIsEWalletOrder(order) {
        if (!order) return false;
        for (const line of order.getOrderlines()) {
            const product = line.product_id;
            if (!product) continue;
            const loyaltyProgramModel = this.models && this.models["loyalty.program"];
            if (!loyaltyProgramModel) continue;
            const linkedPrograms = (
                loyaltyProgramModel.getBy("trigger_product_ids", product.id) || []
            ).filter((p) => p.program_type === "ewallet");
            if (linkedPrograms.length > 0) {
                return true;
            }
        }
        return false;
    },
});
