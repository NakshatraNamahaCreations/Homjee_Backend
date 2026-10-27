// controllers/vendorRatingController.js

const VendorRating = require("../../models/vendor/vendorRating");
const mongoose = require("mongoose");
const UserBooking = require("../../models/user/userBookings");
const City = require("../../models/city/City");

// #6 — resolve the city-specific Google review link for a booking. Falls back
// to null (the rating page then uses its own default link).
async function resolveCityFeedbackLink(bookingId) {
  try {
    const bk = await UserBooking.findById(bookingId)
      .select("address.city")
      .lean();
    const cityName = bk?.address?.city;
    if (!cityName) return null;
    const cityDoc = await City.findOne({
      city: new RegExp(`^\\s*${String(cityName).trim()}\\s*$`, "i"),
    }).lean();
    return cityDoc?.feedbackLink || null;
  } catch (e) {
    console.error("[rating] city feedback link lookup failed:", e?.message);
    return null;
  }
}

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

    // --- STEP 2: If rating is 3–5, no comment needed: auto-save + redirect
    // the customer to the public review link (#6: 3-4-5 stars → redirect). ---
    if (rating >= 3) {
      await VendorRating.create({
        vendorId,
        bookingId,
        customerId,
        rating,
        feedback: "",
        isLocked: true,
      });

      // #6 — redirect 3-4-5 star customers to the city-specific Google review
      // link saved in admin settings (City.feedbackLink).
      const googleUrl = await resolveCityFeedbackLink(bookingId);

      return res.json({
        success: true,
        redirect: true, // frontend redirects to the review link
        googleUrl, // city-specific; null → frontend uses its default
      });
    }

    // --- STEP 3: For 1–2 stars, open the comment box and save the feedback ---
    // if (rating <= 3 && (!feedback || feedback.trim().length === 0)) {
    //     return res.status(400).json({
    //         success: false,
    //         message: "Feedback is required for ratings below 4 stars.",
    //     });
    // }

    // Save low rating + feedback
    await VendorRating.create({
      vendorId,
      bookingId,
      customerId,
      rating,
      feedback: feedback.trim(),
      isLocked: true,
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
      customerId,
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

exports.getLatestRatingsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);

    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid vendorId" });
    }

    const data = await VendorRating.aggregate([
      { $match: { vendorId: new mongoose.Types.ObjectId(vendorId) } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: limit },

      // join customer from "users" collection (because model is mongoose.model("user", ...))
      {
        $lookup: {
          from: "users",
          localField: "customerId",
          foreignField: "_id",
          as: "customerDoc",
        },
      },
      { $unwind: { path: "$customerDoc", preserveNullAndEmptyArrays: true } },

      // join booking from UserBookings collection
      {
        $lookup: {
          from: "userbookings",
          localField: "bookingId",
          foreignField: "_id",
          as: "bookingDoc",
        },
      },
      { $unwind: { path: "$bookingDoc", preserveNullAndEmptyArrays: true } },

      // final shape: only what you asked
      {
        $project: {
          _id: 1,
          rating: 1,
          feedback: 1,
          createdAt: 1,

          customerName: {
            $ifNull: ["$customerDoc.userName", "-"],
          },

          serviceType: {
            $ifNull: ["$bookingDoc.serviceType", "-"],
          },

          bookingId: {
            $ifNull: ["$bookingDoc.bookingDetails.booking_id", "-"],
          },
        },
      },
    ]);

    return res.status(200).json({
      status: "success",
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("getLatestRatingsByVendorId error:", err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

exports.getVendorOverallRatings = async (req, res) => {
  try {
    const { vendorId } = req.params;

    // Validate the vendorId
    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid vendorId",
      });
    }

    // Use aggregation to calculate the average rating and count ratings
    const data = await VendorRating.aggregate([
      { $match: { vendorId: new mongoose.Types.ObjectId(vendorId) } },
      {
        $group: {
          _id: "$vendorId", // Group by vendorId
          totalRatings: { $sum: 1 }, // Count of ratings
          avgRating: { $avg: "$rating" }, // Average rating
        },
      },
    ]);

    if (data.length === 0) {
      return res.status(404).json({
        status: "fail",
        message: "No ratings found for this vendor",
      });
    }

    // Response structure
    return res.status(200).json({
      status: "success",
      data: {
        vendorId,
        totalRatings: data[0].totalRatings,
        averageRating: data[0].avgRating.toFixed(2), // To keep the average rating in 2 decimal points
      },
    });
  } catch (err) {
    console.error("getVendorOverallRatings error:", err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

