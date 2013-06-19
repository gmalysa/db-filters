/**
 * Test multitable join generation
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
		value = db.$eq(db.$md5(db.$concat(this.c.salt, value)));
		terms.push(value.get('password', this, options));
	}
});

var posts = new db('posts', {
	id : db.int_t,
	userId : db.int_t,
	threadId : db.int_t,
	posted : db.datetime_t,
	content : db.text_t
}, {});

exports = {};

exports['left'] = function(test) {
	var sql = posts.select({threadId : 1}, 'p')
					.left_join(users, 'u')
					.on(['userId', 'id'])
					.buildQuery();
	test.equals(sql, 'SELECT `p`.*, `u`.* FROM posts AS p LEFT JOIN users AS u ON `p`.`userId` = `u`.`id` WHERE `p`.`threadId` = 1');

	test.done();
};

exports['right'] = function(test) {
	var sql = users.select({}, 'u')
				.right_join(posts, 'p')
				.on(['id', 'userId'])
				.where(1, {threadId : 1})
				.buildQuery();
	test.equals(sql, 'SELECT `u`.*, `p`.* FROM users AS u RIGHT JOIN posts AS p ON `u`.`id` = `p`.`userId` WHERE `p`.`threadId` = 1');

	test.done();
};

exports['inner'] = function(test) {
	var sql = users.select({id : 1}, 'u')
				.inner_join(posts, 'p')
				.on(['id', 'userId'])
				.buildQuery();
	test.equals(sql, 'SELECT `u`.*, `p`.* FROM users AS u INNER JOIN posts AS p ON `u`.`id` = `p`.`userId` WHERE `u`.`id` = 1');

	test.done();
};

module.exports = exports;
