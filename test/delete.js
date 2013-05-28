/**
 * Tests for delete queries
 */

var db = require('../lib-cov/db-filters');

var users = new db('users', {
	id : db.int_t,
	user : [db.varchar_t, 32],
	password : [db.varchar_t, 32],
	registered : db.datetime_t,
	salt : [db.varchar_t, 8]
}, {
	salt_pw : function(key, value, terms, options) {
		value = db.$eq(db.$md5(db.$concat(db.$f('salt'), value)));
		terms.push(value.get('password', this, options));
	}
});

exports = {};

exports['simple'] = function(test) {
	var sql = users.delete().buildQuery();
	test.equals(sql, 'DELETE FROM users');

	test.done();
};

exports['where'] = function(test) {
	var sql = users.delete({id : [1, 2, 3]}).buildQuery();
	test.equals(sql, 'DELETE FROM users WHERE `id` IN (1, 2, 3)');

	test.done();
};

exports['limit'] = function(test) {
	var sql = users.delete().limit(1, 10).buildQuery();
	test.equals(sql, 'DELETE FROM users LIMIT 1, 10');

	test.done();
};

module.exports = exports;
