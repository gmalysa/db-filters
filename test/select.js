/**
 * Test suite for single table select queries
 *
 * The nice thing is that semantically, these queries don't need to make sense (i.e. select acos(id) ...)
 * as we are just testing for valid syntactical construction
 */

var db = require('../lib-cov/db-filters');

var users = new db('users', {
	id : db.int_t,
	user : [db.varchar_t, 32],
	password : [db.varchar_t, 32],
	registered : db.datetime_t,
	salt : [db.varchar_t, 8],
	status : db.int_t
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

	sql = users.select().fields([db.$left('user', 3), 'prefix']).buildQuery();
	test.equals(sql, 'SELECT LEFT(`user`, \'3\') AS prefix FROM users');

	sql = users.select().fields(db.$mult(db.$acos('id'), 5)).buildQuery();
	test.equals(sql, 'SELECT ACOS(`id`) * 5 FROM users');

	test.done();
}

exports['order'] = function(test) {
	var sql = users.select().order(db.$asc('id')).buildQuery();
	test.equals(sql, 'SELECT * FROM users ORDER BY `id` ASC');

	sql = users.select().order(db.$desc('id'), 'status').buildQuery();
	test.equals(sql, 'SELECT * FROM users ORDER BY `id` DESC, `status`');

	sql = users.select().order(['id', 'registered']).buildQuery();
	test.equals(sql, 'SELECT * FROM users ORDER BY `id`, `registered`');

	test.done();
}

exports['group'] = function(test) {
	var sql = users.select().group('status').buildQuery();
	test.equals(sql, 'SELECT * FROM users GROUP BY `status`');

	var sql = users.select().group(['status', 'registered']).buildQuery();
	test.equals(sql, 'SELECT * FROM users GROUP BY `status`, `registered`');

	test.done();
};

exports['where'] = function(test) {
	var sql = users.select({id : 1}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `id` = 1');

	sql = users.select({id : [1, 2]}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `id` IN (1, 2)');

	sql = users.select({user : db.$like('%bob%')}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `user` LIKE \'%bob%\'');

	sql = users.select({user : db.$not_like('%bob%')}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `user` NOT LIKE \'%bob%\'');

	sql = users.select({user : /^asd/}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `user` REGEXP \'^asd\'');

	sql = users.select({user : db.$not_regex(/^asd/)}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `user` NOT REGEXP \'^asd\'');

	sql = users.select({salt_pw : 'password'}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE `password` = MD5(CONCAT(`salt`, \'password\'))');

	sql = users.select({salt : db.$gt(db.$length(), 5)}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE LENGTH(`salt`) > \'5\'');

	sql = users.select({id : db.$in(db.$pow(2), [1, 2, 4])}).buildQuery();
	test.equals(sql, 'SELECT * FROM users WHERE POW(`id`, 2) IN (1, 2, 4)');

	test.done();
}

module.exports = exports;
