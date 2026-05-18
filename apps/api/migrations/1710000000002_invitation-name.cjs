/* eslint-disable */
/**
 * The admin now sets the invitee's name at invite time (it pre-fills the
 * accept-invite page). Default '' covers any pre-existing pending rows.
 */
exports.up = (pgm) => {
  pgm.sql(`alter table invitations add column name text not null default '';`);
};

exports.down = (pgm) => {
  pgm.sql(`alter table invitations drop column name;`);
};
