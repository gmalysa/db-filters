/**
 * Test suite for single table select queries
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
	var sql = users.select().buildQuery();
	test.equals(sql, 'SELECT * FROM users');
	test.done();
};

exports['limit'] = function(test) {
	var sql = users.select().limit(1).buildQuery();
	test.equals(sql, 'SELECT * FROM users LIMIT 1');

	sql = users.select().limit(1, 2).buildQuery();
	test.equals(sql, 'SELECT * FROM users LIMIT 1, 2');
	
	test.done();
}

exports['fields'] = function(test) {
	var sql = users.select().fields('id', 'user').buildQuery();
	test.equals(sql, 'SELECT `id`, `user` FROM users');

	sql = users.select().fields(db.$count('id')).buildQuery();
	test.equals(sql, 'SELECT COUNT(`id`) FROM users');

	sql = users.select().fields([db.$count('id'), 'c']).buildQuery();
	test.equals(sql, 'SELECT COUNT(`id`) AS c FROM users');

	test.done();
}

exports['order'] = function(test) {
	var sql = users.select().order(db.$asc('id')).buildQuery();
	test.equals(sql, 'SELECT * FROM users ORDER BY `id` ASC');

	sql = users.select().order(db.$desc('id')).buildQuery();
	test.equals(sql, 'SELECT * FROM users ORDER BY `id` DESC');

	test.done();
}

exports['where'] = function(test) {
	var sql = users.select({id : 1}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `id` = 1');

	sql = users.select({id : [1, 2]}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `id` IN (1, 2)');

	test.done();
}

module.exports = exports;
