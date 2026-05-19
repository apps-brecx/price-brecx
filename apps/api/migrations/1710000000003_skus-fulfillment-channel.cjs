/* eslint-disable */
/**
 * Amazon sync stores the listing's fulfillment-channel so the SKUs grid can
 * show the FBA/FBM badge (legacy: "DEFAULT" => FBM, anything else => FBA).
 */
exports.up = (pgm) => {
  pgm.sql(`alter table skus add column fulfillment_channel text;`);
};

exports.down = (pgm) => {
  pgm.sql(`alter table skus drop column fulfillment_channel;`);
};
