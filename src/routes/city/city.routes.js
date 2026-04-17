const express = require("express");
const {
  createCity,
  listCities,
  deleteCity,
} = require("../../controllers/city/city.controller");

const router = express.Router();

router.get("/city-list", listCities);
router.post("/city-create", createCity);
router.delete("/:id", deleteCity);

module.exports = router;
