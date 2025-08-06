
const EventEmitter = require('events');
const sendEmail = require('../utils/sendEmail');

class OrderEvents extends EventEmitter {}
const orderEvents = new OrderEvents();

// Event listeners
orderEvents.on('order:created', async (order) => {
    try {
        await sendEmail(
            order.user.email,
            'Order Confirmation',
            `Your order ${order._id} has been placed successfully.`
        );
    } catch (error) {
        console.error('Failed to send order confirmation:', error);
    }
});

orderEvents.on('order:paid', async (order) => {
    // Send payment confirmation
    // Update inventory
    // Trigger fulfillment process
});

module.exports = orderEvents;