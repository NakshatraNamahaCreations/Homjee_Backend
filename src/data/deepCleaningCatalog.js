// data/deepCleaningCatalog.js
// Static catalog for Category → Subcategory → Services

const CATALOG = [
  {
    category: "Furnished Apartment",
    subcategories: [
      { subcategory: "1 BHK Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "2 BHK Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "3 BHK Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "4 BHK Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "5+ BHK Cleaning", services: ["Classic", "Premium", "Ultimate"] }
    ]
  },
  {
    category: "Unfurnished Apartment",
    subcategories: [
      { subcategory: "1 BHK Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "2 BHK Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "3 BHK Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "4 BHK Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "5+ BHK Cleaning", services: ["Classic", "Premium"] }
    ]
  },
  {
    category: "Book By Room",
    subcategories: [
      { subcategory: "Bedroom Cleaning", services: ["Unfurnished", "Furnished"] },
      { subcategory: "Living Room Cleaning", services: ["Unfurnished", "Furnished"] },
      { subcategory: "Kitchen Cleaning", services: ["Occupied Kitchen", "Occupied Kitchen With Appliances", "Empty Kitchen", "Empty Kitchen With Appliances"] },
      { subcategory: "Bathroom Cleaning", services: [] },
      { subcategory: "Balcony Cleaning", services: ["Small (Upto 3 ft width)", "Big (larger than 3 ft)"] }
    ]
  },
  {
    category: "Furnished Bungalow/Duplex",
    subcategories: [
      { subcategory: "<1200 sqft Bungalow Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "1200-2000 sqft Bungalow Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "2000-3000 sqft Bungalow Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "3000-4000 sqft Bungalow Cleaning", services: ["Classic", "Premium", "Ultimate"] },
      { subcategory: "4000-5000 sqft Bungalow Cleaning", services: ["Classic", "Premium", "Ultimate"] }
    ]
  },
  {
    category: "Unfurnished bungalow/duplex",
    subcategories: [
      { subcategory: "<1200 sqft Bungalow Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "1200-2000 sqft Bungalow Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "2000-3000 sqft Bungalow Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "3000-4000 sqft Bungalow Cleaning", services: ["Classic", "Premium"] },
      { subcategory: "4000-5000 sqft Bungalow Cleaning", services: ["Classic", "Premium"] }
    ]
  },
  {
    category: "Mini services",
    subcategories: [
      { subcategory: "Kitchen Appliances Cleaning", services: ["Gas Stove", "Chimney", "Microwave", "Single Door Fridge", "Double Door Fridge"] },
      { subcategory: "Sofa & Upholstery Wet Shampooing", services: ["3 Seater Sofa", "5 Seater Sofa", "Single mattress", "Double Mattress", "Cushion Chair"] },
      { subcategory: "Utensil Removal & Placement", services: [] },
      { subcategory: "Window Cleaning", services: ["Standard Window Cleaning", "Balcony & Sliding Door Cleaning"] },
      { subcategory: "Furniture Wet Wiping", services: [] },
      { subcategory: "Ceiling Dusting & Cobweb Removal", services: [] }
    ]
  }
];

// Helpers
const CATEGORY_SET = new Set(CATALOG.map(c => c.category));

function getSubcategories(category) {
  const cat = CATALOG.find(c => c.category === category);
  return cat ? cat.subcategories.map(s => s.subcategory) : [];
}

function getServices(category, subcategory) {
  const cat = CATALOG.find(c => c.category === category);
  const sub = cat?.subcategories.find(s => s.subcategory === subcategory);
  return sub ? sub.services : [];
}

// Validate (category, subcategory, service) combination
function isValidCombo(category, subcategory, service) {
  if (!CATEGORY_SET.has(category)) return false;
  const subs = getSubcategories(category);
  if (!subs.includes(subcategory)) return false;

  const services = getServices(category, subcategory); // may be empty (service optional)
  if (services.length === 0) {
    // service must be empty or missing
    return !service || service === "";
  }
  // service must be one of
  return services.includes(service);
}

module.exports = {
  CATALOG,
  CATEGORY_SET,
  getSubcategories,
  getServices,
  isValidCombo
};
