/**
 * Insert query tests
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
	var sql = users.insert({user : 'greg', password : db.$md5('test'), registered : db.$now()}).buildQuery();
	test.equals(sql, 'INSERT INTO users SET `user` = \'greg\', `password` = MD5(\'test\'), `registered` = NOW()');

	test.done();
};

module.exports = exports;
