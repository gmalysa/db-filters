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

c.version('0.1.0')
	.option('-H, --host <host>', 'MySQL host address (default: localhost)')
	.option('-u, --user <user>', 'MySQL user (default: root)')
	.option('-p, --pass <pass>', 'MySQL password. If omitted, you will be prompted')
	.option('-a, --all', 'Generate files for all tables found')
	.option('-d, --database <name>', 'Database name to generate filters for')
	.option('-o, --output <path>', 'Output path for filter definitions (default: ./filters)')
	.parse(process.argv);

var colors = {
	text : ['cyan'],
	defval : ['green', 'bold'],
	param : ['green'],
	header : ['bold', 'blue']
};

function s(str, colors) {
	return _.reduce(colors, function(memo, v) { return memo[v]; }, str);
}

function colorize_prompt(msg, colors) {
	var matches = msg.match(/([^\[]*)(\[[^\]]+\])?/);
	if (matches[2])
		return s(matches[1], colors.text) + s(matches[2], colors.defval) + s(':', colors.text) + ' ';
	else
		return s(matches[1], colors.text) + s(':', colors.text) + ' ';
}

function do_prompt(field, msg) {
	return function _do_prompt(env, after) {
		if (c[field])
			after(c[field]);
		else
			c.prompt(msg, after);
	};
}

function do_prompt_pass(field, msg) {
	return function _do_prompt_pass(env, after) {
		if (c[field])
			after(c[field]);
		else
			c.password(msg, '*', after);
	}
}

function check_prompt(field, defval) {
	return function _check_prompt(env, after, value) {
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

	if (ftype.match(/bigint/i))
		return 'db.bigint_t';
	else if (ftype.match(/int/i))
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
	function prompt(env, after, table) {
		env.table = table;
		env.filter = table;
		c.prompt(colorize_prompt('Filter name for table `'+table+'` ['+table+']', colors), after);
	},
	function check_result(env, after, value) {
		if (value.length > 0)
			env.filter = value;
		after();
	}
);
get_filter_name.name = 'get_filter_name';

var check_if_create = new fl.Chain(
	function prompt_check(env, after, table) {
		env.table = table;
		c.confirm(s('Generate filter for ', colors.text) + s(table, colors.param) + s('?', colors.text) + ' ', after);
	},
	function do_check(env, after, ok) {
		if (ok)
			after(env.table);
		else
			env.$throw({skip : true});
	}
);
check_if_create.name = 'check_if_create';

var process_table = new fl.Chain(
	function check_table(env, after, table, k, list) {
		if (!c.all) {
			check_if_create.call(null, env, after, table);
		}
		else {
			after(table);
		}
	},
	get_filter_name,
	function describe_table(env, after) {
		env.conn.query('DESCRIBE `'+c.database+'`.`'+env.table+'`', env.$check(after));
	},
	function generate_filter(env, after, rows) {
		var cols = [];
		_.each(rows, function(v) {
			var type = get_field_type(v.Type);
			if (type === undefined)
				console.log('*** WARNING ***'.bold.red+' Field '.bold.blue+v.Field.green+' of type '.bold.blue+v.Type.green+' does not match any types that db-filters currently understands. It will be omitted'.blue.bold);
			else
				cols.push(v.Field+' : '+get_field_type(v.Type));
		});

		var output = 'module.exports = function(db) {\n';
		output += '\tvar cols = {\n\t\t';
		output += cols.join(',\n\t\t');
		output += '\n\t};\n\n\tdb.add_filter("'+env.filter+'", new db("'+env.table+'", cols, {}));\n}\n';

		fs.writeFile(c.output+'/'+env.filter+'.js', output, env.$check(after));
	}
);
process_table.name = 'process_table';

// We use the exception stack to skip processing a table that the user doesn't want to generate
process_table.set_exception_handler(function(env, err) {
	if (err.skip) {
		console.log(s('Skipping table ', colors.text) + s(env.table, colors.param));
		env.$catch();
	}
	else {
		env.$throw(err);
	}
});

var main = new fl.Chain(
	function setup_prompt(env, after) {
		console.log(s('Specify Parameters', colors.header));
		after();
	},
	do_prompt('host', colorize_prompt('MySQL host [localhost]', colors)),
	check_prompt('host', 'localhost'),
	do_prompt('user', colorize_prompt('MySQL user [root]', colors)),
	check_prompt('user', 'root'),
	do_prompt_pass('pass', colorize_prompt('MySQL password', colors)),
	check_prompt('pass', undefined),
	do_prompt('database', colorize_prompt('MySQL database', colors)),
	check_prompt('database', undefined),
	do_prompt('output', colorize_prompt('Output directory [./filters]', colors)),
	check_prompt('output', './filters'),
	function show_summary(env, after) {
		console.log(s('\nOption Summary', colors.header));
		console.log(s('MySQL host ', colors.text) + s(c.host, colors.param));
		console.log(s('MySQL user ', colors.text) + s(c.user, colors.param));
		console.log(s('MySQL pass ', colors.text) + s('(hidden)', ['red']));
		console.log(s('Database to process ', colors.text) + s(c.database, colors.param));
		console.log(s('Output directory ', colors.text) + s(c.output, colors.param));
		if (c.all)
			console.log(s('Processing all tables', colors.text));
		else
			console.log(s('Prompting for tables', colors.text));
		c.prompt(s('\nPress enter to continue, or ctrl+c to cancel', colors.header)+' ', after);
	},
	function generate(env, after, input) {
		console.log(s('\nGenerating Definitions', colors.header));
		env.conn = mysql.createConnection({
			host : c.host,
			user : c.user,
			password : c.pass
		});

		env.conn.connect();
		env.conn.query('SHOW TABLES IN `'+c.database+'`', env.$check(after));
	},
	function get_tables(env, after, rows) {
		rows = _.map(rows, function(v) { return _.values(v)[0]; });
		after(rows);
	},
	fl.p.seach(process_table)
);
main.name = 'main';

var env = new fl.Environment();
main.set_exception_handler(function(env, err) {
	console.log('Error: '+err.message);
	console.log(err.backtrace);
	env.$catch();
});
main.call(null, env, process.exit);

