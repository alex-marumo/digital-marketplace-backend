const { Artwork } = require("../models");

const createArtwork = async (req, res) => {
  try {
    const artwork = await Artwork.create({ ...req.body, artistId: req.user.id });
    res.status(201).json(artwork);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getArtworks = async (req, res) => {
  try {
    const artworks = await Artwork.findAll();
    res.json(artworks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { createArtwork, getArtworks };
