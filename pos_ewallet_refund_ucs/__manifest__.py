{
    'name': 'POS eWallet Refund UCS',
    'version': '17.0.1.0.0',
    "website": "https://uncannycs.com",
    "author": "Uncanny Consulting Services LLP",
    "maintainers": "Uncanny Consulting Services LLP",
    'category': 'Point of Sale',
    'summary': 'Allow direct refund of eWallet top-ups with balance validation',
    'description': """
        This module allows refunding eWallet top-up products and adds a validation 
        to ensure the refund amount does not exceed the customer's eWallet balance.
    """,
    'depends': ['point_of_sale', 'pos_loyalty'],
    'data': [],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_ewallet_refund_ucs/static/src/js/pos_store.js',
            'pos_ewallet_refund_ucs/static/src/js/ticket_screen.js',
            'pos_ewallet_refund_ucs/static/src/js/payment_screen.js',
            'pos_ewallet_refund_ucs/static/src/js/order_widget.js',
            'pos_ewallet_refund_ucs/static/src/xml/order_widget.xml',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
