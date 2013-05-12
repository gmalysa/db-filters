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

function s(str, colors) {
	return _.reduce(colors, function(memo, v) { return memo[v]; }, s);
}

function colorize_prompt(msg, colors) {
	
}

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
	var match = type.match(/([^\(]*)(?:\((\d+)\))?/);
	var ftype = match[1];
	var length = match[2];

	if (ftype.match(/int/i))
		return 'db.int_t';
	else if (type.match(/varchar/i))
		return '[db.varchar_t, '+length+']';
	else if (type.match(/datetime/i))
		return 'db.datetime_t';
	else if (type.match(/timestamp/i))
		return 'db.timestamp_t';
	else if (type.match(/text/i))
		return 'db.text_t';
	else
		return undefined;
}

var get_filter_name = new fl.Chain(
	function (env, after, table) {
		env.table = table;
		env.filter = table;
		c.prompt('Filter name for table '+table+' ['+table+']: ', after);
	},
	function (env, after, value) {
		if (value.length > 0)
			env.filter = value;
		after();
	}
);

var process_table = new fl.Chain(
	get_filter_name,
	function (env, after) {
		env.conn.query('DESCRIBE '+c.database+'.'+env.table, after);
	},
	function (env, after, err, rows) {
		var cols = [];
		_.each(rows, function(v) {
			var type = get_field_type(v.Type);
			if (type === undefined)
				console.log('WARNING:'.bold.red+' Field '+v.Field+' of type '+v.Type+' does not match any types that db-filters currently understands. It will be omitted');
			else
				cols.push(v.Field+' : '+get_field_type(v.Type));
		});
		var output = 'module.exports = function(db) {\n';
		output += '\tvar cols = {\n\t\t';
		output += cols.join(',\n\t\t');
		output += '\n\t};\n\n\tdb.add_filter("'+env.filter+'", new db("'+env.table+'", cols, {});\n}\n';
		fs.writeFile(c.output+'/'+env.filter+'.js', output, after);
	},
	function (env, after, err) {
		if (err) {
			env.$throw(err);
		}
		else {
			after();
		}
	}
);

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
			after(rows, after);
		}
	},
	function (env, after, rows, loop) {
		if (rows.length > 0) {
			var row = rows.shift();
			process_table.call(null, env, _.partial(loop, rows, loop), row);
		}
		else {
			after();
		}
	}
);

var env = fl.mkenv({}, console.log);
main.set_abort_handler(function(env, err) {
	console.log(gls.inspect(err));
	env.$catch();
});
main.call(null, env, process.exit);

