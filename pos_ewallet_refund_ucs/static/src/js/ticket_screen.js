/** @odoo-module **/

import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { patch } from "@web/core/utils/patch";

patch(TicketScreen.prototype, {
    _isEWalletGiftCard(orderline) {
        // Bypass the restriction that prevents refunding eWallet or gift card top-ups
        // returning false allows the refund button to work on these lines.
        return false;
    }
});
