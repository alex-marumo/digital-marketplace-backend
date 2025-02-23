module.exports = (sequelize, DataTypes) => {
  const Artwork = sequelize.define("Artwork", {
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    category: { type: DataTypes.STRING },
    price: { type: DataTypes.FLOAT, allowNull: false },
    images: { type: DataTypes.ARRAY(DataTypes.STRING) },
  });
  return Artwork;
};

