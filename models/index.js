const { Sequelize } = require("sequelize");
const config = require("../config/config")[process.env.NODE_ENV || "development"];

const sequelize = config.use_env_variable
  ? new Sequelize(process.env.DATABASE_URL, config)
  : new Sequelize(config.database, config.username, config.password, config);

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.User = require("./User")(sequelize, Sequelize);
db.Artwork = require("./Artwork")(sequelize, Sequelize);

// Define associations if needed
db.User.hasMany(db.Artwork, { foreignKey: "artistId" });
db.Artwork.belongsTo(db.User, { foreignKey: "artistId" });

module.exports = db;
