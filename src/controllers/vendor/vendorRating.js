// controllers/vendorRatingController.js

const VendorRating = require("../../models/vendor/vendorRating");

exports.addVendorRating = async (req, res) => {
    try {
        const { vendorId, bookingId, customerId, rating, feedback } = req.body;

        // --- STEP 1: Check if already submitted ---
        const existing = await VendorRating.findOne({ bookingId, customerId });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: "You have already submitted a rating for this booking.",
            });
        }

        // --- STEP 2: If rating is 4–5, no feedback needed: auto-save ---
        if (rating >= 4) {
            await VendorRating.create({
                vendorId,
                bookingId,
                customerId,
                rating,
                feedback: "",
                isLocked: true,
            });

            return res.json({
                success: true,
                redirect: true, // frontend will redirect to Google Review
            });
        }

        // --- STEP 3: For 1–3 stars, feedback is required ---
        if (rating <= 3 && (!feedback || feedback.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                message: "Feedback is required for ratings below 4 stars.",
            });
        }

        // Save low rating + feedback
        await VendorRating.create({
            vendorId,
            bookingId,
            customerId,
            rating,
            feedback: feedback.trim(),
            isLocked: true
        });

        return res.json({
            success: true,
            message: "Rating submitted successfully.",
        });

    } catch (error) {
        console.error("Rating Error:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while submitting rating.",
        });
    }
};

exports.getVendorRating = async (req, res) => {
    try {
        const { vendorId, bookingId, customerId } = req.query;

        if (!vendorId || !bookingId || !customerId) {
            return res.status(400).json({
                success: false,
                message: "vendorId, bookingId and customerId are required",
            });
        }

        // Check if rating already exists
        const rating = await VendorRating.findOne({
            vendorId,
            bookingId,
            customerId
        }).lean();

        if (!rating) {
            return res.json({
                success: true,
                exists: false,
                message: "No rating found for this booking",
            });
        }

        // Rating exists -> Lock UI in frontend
        return res.json({
            success: true,
            exists: true,
            isLocked: rating.isLocked,
            rating: rating.rating,
            feedback: rating.feedback,
            createdAt: rating.createdAt,
        });

    } catch (error) {
        console.error("Error fetching rating:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while fetching the rating",
        });
    }
};
