const express = require("express");
const {
  createCity,
  listCities,
  deleteCity,
  updateCity
} = require("../../controllers/city/city.controller");

const router = express.Router();

router.get("/city-list", listCities);
router.post("/city-create", createCity);
router.delete("/:id", deleteCity);
router.put("/:id", updateCity);


module.exports = router;
