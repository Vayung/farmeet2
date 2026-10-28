const nodemailer = require("nodemailer");

console.log("SMTP HOST:", process.env.SMTP_HOST);
console.log("SMTP USER:", process.env.SMTP_USER);

const transporter =
nodemailer.createTransport({
 host: process.env.SMTP_HOST,
 port: 465,
 secure: true,
 auth: {
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS
 }
});

const sendOTPEmail =
async (email, otp) => {

 await transporter.sendMail({
  from: process.env.SMTP_USER,
  to: email,
  subject: "OTP Verification",
  text: `Your OTP is ${otp}`
 });

};

module.exports = sendOTPEmail;