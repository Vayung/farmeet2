const express = require('express');
const mongooese = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const User = require("./models/User");
const { default: mongoose } = require('mongoose');
const rejectMongoOperators = require("./middleware/rejectMongoOperators");

const app = express();

app.use(express.json({ limit: "10kb" }));
app.use(rejectMongoOperators);

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

mongoose
.connect(process.env.MONGO_URI, 0)
.then(async () => {
  await User.syncIndexes();
  console.log("MONGODB CONNECTED");
})
.catch((err) => console.log(err));

app.listen(process.env.PORT,'0.0.0.0', () => {
    console.log(`Server running on port ${process.env.PORT}`);
});