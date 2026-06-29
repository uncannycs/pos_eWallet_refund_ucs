/** @odoo-module **/

import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { patch } from "@web/core/utils/patch";

patch(ProductScreen.prototype, {
    onNumpadClick(buttonValue) {
        if (["quantity", "discount", "price"].includes(buttonValue)) {
            return super.onNumpadClick(...arguments);
        }

        const order = this.pos.selectedOrder;
        // Bypass the restriction if the selected line is an eWallet top-up refund
        if (order && order.isRefund && buttonValue !== "Backspace") {
            const selectedLine = order.getSelectedOrderline();
            if (selectedLine && selectedLine.product_id) {
                const loyaltyProgramModel = this.pos.models && this.pos.models["loyalty.program"];
                const linkedPrograms = loyaltyProgramModel ? (
                    loyaltyProgramModel.getBy("trigger_product_ids", selectedLine.product_id.id) || []
                ).filter((p) => p.program_type === "ewallet") : [];
                
                if (linkedPrograms.length > 0) {
                    // Allow the update to proceed normally
                    this.numberBuffer.sendKey(buttonValue);
                    return;
                }
            }
        }
        
        return super.onNumpadClick(...arguments);
    }
});
