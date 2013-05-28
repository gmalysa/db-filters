/**
 * Update query tests
 */

var db = require('../lib-cov/db-filters');

var users = new db('users', {
	id : db.int_t,
	user : [db.varchar_t, 32],
	password : [db.varchar_t, 32],
	registered : db.datetime_t,
	salt : [db.varchar_t, 8],
	post_count : db.int_t
}, {
	salt_pw : function(key, value, terms, options) {
		value = db.$eq(db.$md5(db.$concat(db.$f('salt'), value)));
		terms.push(value.get('password', this, options));
	}
});

exports = {};

exports['simple'] = function(test) {
	var sql = users.update({post_count : 0}).buildQuery();
	test.equals(sql, 'UPDATE users SET `post_count` = 0');

	test.done();
};

exports['increment'] = function(test) {
	var sql = users.update({post_count : db.$add(1)}, {id : 5}).buildQuery();
	test.equals(sql, 'UPDATE users SET `post_count` = `post_count` + 1 WHERE `id` = 5');

	test.done();
};

exports['limit'] = function(test) {
	var sql = users.update({post_count : 100}).limit(5).buildQuery();
	test.equals(sql, 'UPDATE users SET `post_count` = 100 LIMIT 5');

	test.done();
}

module.exports = exports;
