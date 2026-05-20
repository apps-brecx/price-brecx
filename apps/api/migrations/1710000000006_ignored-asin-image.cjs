/* eslint-disable */
/**
 * Snapshot the listing thumbnail when an ASIN is ignored so the Ignored tab
 * shows the same product image as the Losses tab.
 */
exports.up = (pgm) => {
  pgm.sql(`alter table ignored_asins add column image_url text;`);
};

exports.down = (pgm) => {
  pgm.sql(`alter table ignored_asins drop column image_url;`);
};
