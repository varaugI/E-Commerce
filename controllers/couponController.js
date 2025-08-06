exports.applyCoupon = async (req, res) => {
    try {
        const { couponCode, orderTotal } = req.body;
        
        const coupon = await Coupon.findOne({
            code: couponCode,
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() },
            usageCount: { $lt: '$maxUses' }
        });

        if (!coupon) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired coupon'
            });
        }

        // Check minimum order value
        if (orderTotal < coupon.minOrderValue) {
            return res.status(400).json({
                success: false,
                message: `Minimum order value of $${coupon.minOrderValue} required`
            });
        }

        const discount = calculateDiscount(coupon, orderTotal);
        
        res.json({
            success: true,
            data: {
                discount,
                finalTotal: orderTotal - discount,
                couponId: coupon._id
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Coupon application failed' });
    }
};