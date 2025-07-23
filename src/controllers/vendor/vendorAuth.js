const vendorAuthSchema = require("../../models/vendor/vendorAuth");

exports.createVendor = async (req, res) => {
  try {
    const {
      vendor,
      documents,
      bookingDetails,
      assignedProfessional,
      address,
      selectedSlot,
      isEnquiry,
    } = req.body;

    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    const booking = new vendorAuthSchema({
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
        lat: address.lat,
        long: address.long,
      },
      selectedSlot: {
        // slotId: selectedSlot.slotId,
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
