const express = require("express");
const router = express.Router();
const { createArtwork, getArtworks } = require("../controllers/artworkController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", getArtworks);
router.post("/", authMiddleware, createArtwork);

module.exports = router;
