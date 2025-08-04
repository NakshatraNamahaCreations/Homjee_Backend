const UserBooking = require("../../models/user/userBookings");
const moment = require("moment");

function generateOTP() {
  return Math.floor(1000 + Math.random() * 10000).toString();
}
exports.createBooking = async (req, res) => {
  try {
    const {
      customer,
      service,
      bookingDetails,
      assignedProfessional,
      address,
      selectedSlot,
      isEnquiry,
    } = req.body;

    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    // console.log("Address in request body:", JSON.stringify(address, null, 2));

    let coords = [0, 0];
    if (
      address.location &&
      Array.isArray(address.location.coordinates) &&
      address.location.coordinates.length === 2 &&
      typeof address.location.coordinates[0] === "number" &&
      typeof address.location.coordinates[1] === "number"
    ) {
      coords = address.location.coordinates;
    } else {
      // Handle invalid or missing coordinates (throw error or default)
      throw new Error("Invalid or missing address.location.coordinates");
    }

    const booking = new UserBooking({
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
      },
      isEnquiry,
      service: service.map((s) => ({
        category: s.category,
        serviceName: s.serviceName,
        price: s.price,
        quantity: s.quantity,
      })),

      bookingDetails: {
        bookingDate: bookingDetails.bookingDate,
        bookingTime: bookingDetails.bookingTime,
        status: bookingDetails.status || "Pending",
        paymentMethod: bookingDetails.paymentMethod || "Cash",
        paymentStatus: bookingDetails.paymentStatus || "Unpaid",
        paidAmount: bookingDetails.paidAmount,
        amountYetToPay: bookingDetails.amountYetToPay,
        otp: generateOTP(),
      },
      assignedProfessional: assignedProfessional
        ? {
            professionalId: assignedProfessional.professionalId,
            name: assignedProfessional.name,
            phone: assignedProfessional.phone,
          }
        : undefined,
      address: {
        houseFlatNumber: address.houseFlatNumber,
        streetArea: address.streetArea,
        landMark: address.landMark,
        location: {
          type: "Point",
          coordinates: coords,
        },
      },

      selectedSlot: {
        slotDate: selectedSlot.slotDate,
        slotTime: selectedSlot.slotTime,
      },
    });

    await booking.save();

    res.status(201).json({ message: "Booking created successfully", booking });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await UserBooking.find().sort({ createdAt: -1 });
    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllLeadsBookings = async (req, res) => {
  try {
    const bookings = await UserBooking.find({ isEnquiry: false }).sort({
      createdAt: -1,
    });
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllEnquiries = async (req, res) => {
  try {
    const bookings = await UserBooking.find({ isEnquiry: true }).sort({
      createdAt: -1,
    });
    res.status(200).json({ allEnquies: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingsByBookingId = async (req, res) => {
  try {
    const booking = await UserBooking.findById({ _id: req.params.id });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ booking });
  } catch (error) {
    console.error("Error fetching booking by bookingId:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingsByCustomerId = async (req, res) => {
  try {
    const { customerId } = req.params;

    const bookings = await UserBooking.find({
      "customer.customerId": customerId,
    }).sort({ createdAt: -1 });

    if (!bookings || bookings.length === 0) {
      return res
        .status(404)
        .json({ message: "No bookings found for this customer" });
    }

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings by customerId:", error);
    res.status(500).json({ message: "Server error" });
  }
};
// only for today
// exports.getBookingForNearByVendors = async (req, res) => {
//   try {
//     const { lat, long } = req.params;
//     if (!lat || !long) {
//       return res.status(400).json({ message: "Coordinates required" });
//     }
//     const now = new Date();
//     const todayStart = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate()
//     );
//     const todayEnd = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate() + 2
//     );

//     const nearbyBookings = await UserBooking.find({
//       "address.location": {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates: [parseFloat(long), parseFloat(lat)],
//           },
//           $maxDistance: 5000, // 5 km
//         },
//       },
//       isEnquiry: false,
//       "bookingDetails.status": "Pending",
//       "selectedSlot.slotDate": {
//         $gte: todayStart,
//         $lt: todayEnd,
//       },
//     }).sort({ createdAt: -1 });

//     const filteredBookings = nearbyBookings.filter((booking) => {
//       const slotDate = moment(booking.selectedSlot.slotDate); // This is a Date object
//       const slotTimeStr = booking.selectedSlot.slotTime; // e.g., "01:00 PM"

//       // Combine slot date + slot time into one moment object
//       const slotDateTime = moment(
//         `${slotDate.format("YYYY-MM-DD")} ${slotTimeStr}`,
//         "YYYY-MM-DD hh:mm A"
//       );

//       // Keep only future slots
//       return slotDateTime.isAfter(moment());
//     });

//     if (!filteredBookings.length) {
//       return res
//         .status(404)
//         .json({ message: "No bookings found near this location" });
//     }

//     res.status(200).json({ bookings: filteredBookings });
//   } catch (error) {
//     console.error("Error finding nearby bookings:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.getBookingForNearByVendors = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const dayAfterTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2
    );

    // Fetch bookings for today and tomorrow
    const nearbyBookings = await UserBooking.find({
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000, // 5 km
        },
      },
      isEnquiry: false,
      "bookingDetails.status": "Pending",
      "selectedSlot.slotDate": {
        $gte: todayStart,
        $lt: dayAfterTomorrow,
      },
    }).sort({ createdAt: -1 });

    const nowMoment = moment();

    const filteredBookings = nearbyBookings.filter((booking) => {
      const slotDateObj = booking.selectedSlot?.slotDate;
      const slotTimeStr = booking.selectedSlot?.slotTime;
      if (!slotDateObj || !slotTimeStr) return false;

      const slotDateMoment = moment(slotDateObj);
      const slotDateStr = slotDateMoment.format("YYYY-MM-DD");
      const slotDateTime = moment(
        `${slotDateStr} ${slotTimeStr}`,
        "YYYY-MM-DD hh:mm A"
      );

      // Today: keep only future-times
      if (slotDateMoment.isSame(nowMoment, "day")) {
        return slotDateTime.isAfter(nowMoment);
      }
      // Tomorrow: keep all
      if (slotDateMoment.isSame(nowMoment.clone().add(1, "day"), "day")) {
        return true;
      }
      // Should not reach here due to date range, but just in case
      return false;
    });

    if (!filteredBookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found near this location" });
    }

    res.status(200).json({ bookings: filteredBookings });
  } catch (error) {
    console.error("Error finding nearby bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateConfirmedStatus = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;
    console.log("bookingId", bookingId);
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    const booking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ message: "Booking updated", booking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getBookingExceptPending = async (req, res) => {
  try {
    const { professionalId } = req.params;
    if (!professionalId) {
      return res.status(400).json({ message: "Professional ID is required" });
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const todayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2
    );

    const bookings = await UserBooking.find({
      "assignedProfessional.professionalId": professionalId,
      "bookingDetails.status": { $ne: "Pending" },
      "selectedSlot.slotDate": {
        $gte: todayStart,
        $lt: todayEnd,
      },
    }).lean();

    const filtered = bookings.filter((booking) => {
      const { slotDate, slotTime } = booking.selectedSlot || {};
      if (!slotDate || !slotTime) return false;

      // slotDate is Date, slotTime is string like '02:00 PM'
      const dateStr = moment(slotDate).format("YYYY-MM-DD");
      const slotDateTime = moment(
        `${dateStr} ${slotTime}`,
        "YYYY-MM-DD hh:mm A"
      );

      return slotDateTime.isSameOrAfter(moment());
    });

    return res.status(200).json({ leadsList: filtered });
  } catch (error) {
    console.error("Error finding confirmed bookings:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.getBookingExceptPending = async (req, res) => {
//   try {
//     const { professionalId } = req.params;

//     if (!professionalId) {
//       return res.status(400).json({ message: "Professional ID is required" });
//     }
//     const now = new Date();
//     const todayStart = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate()
//     );
//     const todayEnd = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate() + 1
//     );

//     const confirmedBookings = await UserBooking.find({
//       "assignedProfessional.professionalId": professionalId,
//       "bookingDetails.status": { $ne: "Pending" },
//       "selectedSlot.slotDate": {
//         $gte: todayStart,
//         $lt: todayEnd,
//       },
//       // If you want to exclude multiple statuses (for example, "Pending" and "Cancelled"), use $nin (Not In)
//       //  "bookingDetails.status": { $nin: ["Pending", "Cancelled"] },
//     })
//       // .sort({ createdAt: -1 })
//       .lean();

//     return res.status(200).json({ leadsList: confirmedBookings });
//   } catch (error) {
//     console.error("Error finding confirmed bookings:", error);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

exports.startJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional, otp } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }
    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Step 2: Compare OTP
    const storedOtp = booking.bookingDetails?.otp;
    if (parseInt(storedOtp) !== parseInt(otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // Step 3: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // Step 4: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Job Started", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.endJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // Step 2: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Job Completed", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const {
      bookingId,
      paidAmount,
      editedPrice,
      payToPay,
      reason,
      scope,
      hasPriceUpdated,
      paymentStatus,
    } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // Step 2: Prepare update fields
    const updateFields = {};
    if (paidAmount) updateFields["bookingDetails.paidAmount"] = paidAmount;
    if (editedPrice) updateFields["bookingDetails.editedPrice"] = editedPrice;
    if (payToPay) updateFields["bookingDetails.amountYetToPay"] = payToPay;
    if (reason) updateFields["bookingDetails.reasonForChanging"] = reason;
    if (scope) updateFields["bookingDetails.scope"] = scope;
    if (hasPriceUpdated)
      updateFields["bookingDetails.hasPriceUpdated"] = hasPriceUpdated;
    if (paymentStatus)
      updateFields["bookingDetails.paymentStatus"] = paymentStatus;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Price Updated", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating price:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const {
      bookingId,
      status, //reasonForCancelled
    } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // Step 2: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    // if (reasonForCancelled)
    //   updateFields["bookingDetails.reasonForCancelled"] = reasonForCancelled;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({
      message: "Status Updated",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.cancelJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Job Cancelled", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// // Delete booking
// exports.deleteBooking = async (req, res) => {
//   try {
//     const booking = await userBookingSchema.findByIdAndDelete(req.params.id);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }
//     res.status(200).json({ message: "Booking deleted" });
//   } catch (error) {
//     console.error("Error deleting booking:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };
