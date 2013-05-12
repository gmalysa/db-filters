/**
 * Tool to generate a set of table definitions from a database automatically
 * This will overwrite anything that stands in its way
 */

var mysql = require('mysql');
var c = require('commander');
var _ = require('underscore');
var fs = require('fs');
require('colors');

var fl = require('flux-link');
var db = require('./db-filters');
var spy = require('spyglass');
var gls = new spy();

var logger = require('./logger');

c.version('0.1.0')
	.option('-H, --host <localhost>', 'MySQL host address')
	.option('-u, --user <root>', 'MySQL user')
	.option('-p, --pass <pass>', 'MySQL password. If omitted, you will be prompted')
	.option('-a, --all', 'Generate files for all tables found')
	.option('-d, --database <name>', 'Database name to generate filters for')
	.option('-o, --output <./filters>', 'Output path for filter definitions')
	.parse(process.argv);

function do_prompt(field, msg) {
	return function (env, after) {
		if (c[field])
			after(c[field]);
		else
			c.prompt(msg, after);
	};
}

function do_prompt_pass(field, msg) {
	return function (env, after) {
		if (c[field])
			after(c[field]);
		else
			c.password(msg, '*', after);
	}
}

function check_prompt(field, defval) {
	return function (env, after, value) {
		if (value.length > 0)
			c[field] = value;
		else if (defval !== undefined)
			c[field] = defval;
		else {
			env.$throw(new Error('Missing required value!'));
			return;
		}
		after();
	};
}

function get_field_type(type) {
	var match = type.match(/([^\(]*)\((\d+)\)/);
	var ftype = match[1];
	var length = match[2];

	if (ftype.match(/int/i))
		return 'db.int_t';
	else if (type.match(/varchar/i))
		return '[db.varchar_t, '+length+']';
	else
		return undefined;
}

var main = new fl.Chain(
	do_prompt('host', 'MySQL host [localhost]: '),
	check_prompt('host', 'localhost'),
	do_prompt('user', 'MySQL user [root]: '),
	check_prompt('user', 'root'),
	do_prompt_pass('pass', 'MySQL password: '),
	check_prompt('pass', undefined),
	do_prompt('database', 'MySQL database: '),
	check_prompt('database', undefined),
	do_prompt('output', 'Output directory [./filters]: '),
	check_prompt('output', './filters'),
	function (env, after) {
		console.log('Summary:');
		console.log('\tMySQL host: '+c.host);
		console.log('\tMySQL user: '+c.user);
		console.log('\tMySQL pass: (hidden)');
		console.log('\tDatabase to process: '+c.database);
		console.log('\tOutput directory: '+c.output);
		if (console.all)
			console.log('\tProcessing all tables');
		else
			console.log('\tPrompting for tables');
		after();
	},
	function (env, after) {
		env.conn = mysql.createConnection({
			host : c.host,
			user : c.user,
			password : c.pass
		});

		env.conn.connect();
		env.conn.query('SHOW TABLES IN '+c.database, after);
	},
	function (env, after, err, rows) {
		if (err) {
			env.$throw(err);
		}
		else {
			rows = _.map(rows, function(v) { return _.values(v)[0]; });
			env.conn.query('DESCRIBE '+c.database+'.'+rows[0], after);
		}
	},
	function (env, after, err, rows) {
		if (err)
			env.$throw(err);
		_.each(rows, function(v) {
			logger.var_dump(get_field_type(v.Type), v.Field);
		});
		after();
	}
);

var env = fl.mkenv({}, console.log);
main.set_abort_handler(function(env, err) {
	console.log(gls.inspect(err));
	env.$catch();
});
main.call(null, env, process.exit);

