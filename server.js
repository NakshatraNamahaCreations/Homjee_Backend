const app = require("./src/app");
const dotenv = require("dotenv");
const { connectDB } = require("./src/config/db");

dotenv.config({ quiet: true });

connectDB();

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Server running on port at http://localhost:${PORT}`);
});
