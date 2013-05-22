/**
 * Automatic query generation tools to simplify writing SQL and interacting with
 * databases. Currently, this supports MySQL, but ideally it'd be able to generate
 * valid queries for a wide variety of databases, facilitating backend changes.
 *
 * The main purpose is to provide a more powerful interface for specifying data to
 * be sent to the database, allowing complete types to be used transparently, with
 * translation defined on the table level (i.e. this object maps to these fields,
 * in these ways).
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var _ = require('underscore');
var mysql = require('mysql');
var crypto = require('crypto');
var fs = require('fs');

var op = require('./operators');
var q = require('./queries');

/**
 * Constructor for the db filter takes options to define the table that it will be
 * used to filter
 * @param table The name of the table
 * @param columns Any non-string columns that should be handled with a built-in
 * @param special Any special fields that will be handled externally with a callback
 */
function db(table, columns, special) {
	this.queries = {};		//!< Queries that have been executed, for stats and information
	this.conn = null;		//!< The connection to use for SQL query execution

	this.table = table;
	this.columns = columns || {};
	this.special = special || {};
}

// Static/constant definition
_.extend(db, {
	// Database field constants
	int_t : 1,				//!< Indicates that a field is one of the INT types (TINY, SMALL, etc.)
	date_t : 2,				//!< Indicates that a field is a DATE type (*not* DATETIME, TIMESTAMP, etc.)
	datetime_t : 3,			//!< Indicates that a field is a DATETIME or TIMESTAMP type
	timestamp_t : 3,		//!< Alias for DATETIME, as both TIMESTAMP and DATETIME are implemented the same way
	varchar_t : 4,			//!< Should be used in an array with the length of the field, and data will be truncated
	text_t : 5,				//!< Long text field. Falls back to mysql.escape(). Included so that we can add all fields to the declaration
	char_t : 6,				//!< Should be used in an array with the length of the field
	
	// Logging levels
	l_debug : 3,			//!< Provides debugging-quality output, including verbose query information and incorrect usage info (i.e. calling limit() on an InsertQuery)
	l_info : 2,				//!< Provides informative output, like query strings
	l_error : 1,			//!< Provides only error messages received from the server
	l_none : 0,				//!< Provides no logging at all

	// Static information about logging
	fn_log : null,			//!< Callback for logging, takes one parameter, the message
	log_level : db.l_none,	//!< Default log level

	// A place to store filter definitions on the main tree
	filters : {},			//!< Map of filter names to filter definitions, where stuff is stored

	/**
	 * Static initialization routine, this is used to take a folder of filter definitions
	 * and import them automatically, so that you don't have to manually update it as
	 * table definitions are added/removed
	 * @param path The path to where all of the table definitions are stored
	 * @param log Callback to invoke for each file to be read to log the action, optional
	 */
	init : function(path, log, log_level) {
		db.set_log(log);
		db.set_log_level(log_level);

		var files = fs.readdirSync(path);
		
		_.each(files, function(f) {
			// Skip hidden files...
			if (f[0] == '.')
				return;

			// Pass the module name to the logging function
			db.log(db.l_info, f);

			// Each filter should be implemented as a single function that takes the db object
			// and then creates an instance with appropriate column/table/special info, and saves
			// it with add_filter()
			var filter = require(path+'/'+f);
			filter(db);
		});
	},

	/**
	 * Adds a new filter definition to the tracking list
	 * @param name Table/reference name for the filter
	 * @param filter The filter definition (an instance of db)
	 */
	add_filter : function(name, filter) {
		db.filters[name] = filter;
	},

	/**
	 * Clones all of the filters that have been defined and returns them as a single hash with the
	 * same reference names they were defined as. Convenience provided for the instance clone method
	 * in the event that you simply want to copy all of your filters in one line of code, for a given
	 * request
	 */
	clone_filters : function() {
		var filters = {};
		_.each(db.filters, function(v, k) {
			filters[k] = v.clone();
		});
		return filters;
	},

	/**
	 * Sets a single connection object to all of the filters given in the supplied connection, again
	 * useful to reduce copy/pasting code. This does not support invoking the callback available to
	 * set_conn, for now
	 * @param conn The connection object to store in each filter
	 * @param filters The collection of filters to store connections in
	 */
	set_conn_all : function(conn, filters) {
		_.each(filters, function(v) {
			v.set_conn(conn, null);
		});
	},

	/**
	 * Changes the logging function
	 * @param log The new function to call when logging stuff, null disables logging
	 */
	set_log : function(log) {
		db.fn_log = log;
	},

	/**
	 * Changes the logging level
	 * @param level The new logging level to use
	 */
	set_log_level : function(level) {
		db.log_level = level;
	},

	/**
	 * Function to log a message using the registered logging callback, at a specified log
	 * level. If the current log level is less than the specified level, the message will
	 * be silently ignored; otherwise it will be passed to the loggin callback verbatim
	 * @param level The log level of this message
	 * @param msg The message to log
	 */
	log : function(level, msg) {
		if (level <= db.log_level && db.fn_log)
			db.fn_log(msg);
	},

// Also, add the operator definitions directly to db in order to be easily accessible
}, op.operators);

// Member/instance data definition
_.extend(db.prototype, {
	/**
	 * Because filters are defined globally but should not be shared between requests, each
	 * request should clone the filters that it wants to use during database acquisition
	 * @return a clone of this with no shared state
	 */
	clone : function() {
		return new db(this.table, this.cols, this.special);
	},

	/**
	 * Callback used to store the mysql connection that should be used. This will
	 * forward to another callback (if given), allowing it to be used inside another chain
	 * @param conn The mysql connection object to save
	 * @param after The callback to invoke chaining after this one, optional
	 */
	set_conn : function(conn, after) {
		this.conn = conn;
		if (after)
			after();
	},

	/**
	 * Creates and executes a SELECT query for the options given, passes control to callback
	 * when complete
	 * @param where Object used to specify what we're selecting by
	 * @param alias Optional table alias, only used if this later becomes a joined query
	 * @return Query object that can have its properties modified before executing
	 */
	select : function(where, alias) {
		return new q.SelectQuery(this, where, alias);
	},

	/**
	 * Creates and executes an INSERT query for the options given
	 * @param values The object to be inserted to the db
	 * @return Query object that can have its properties modified before executing
	 */
	insert : function(values) {
		return new q.InsertQuery(this, values);
	},

	/**
	 * Creates and executes an UPDATE query for the options given
	 * @param update The new values to be written
	 * @param where Object used to specify what to update
	 * @return Query object that can have its properties modified before executing
	 */
	update : function(update, where) {
		return new q.UpdateQuery(this, update, where);
	},

	/**
	 * Creates and executes a DELETE query for the options given
	 * @param where Object specifying what to delete
	 * @return Query object that can have its properties modified before executing
	 */
	delete : function(where) {
		return new q.DeleteQuery(this, where);
	},

	/**
	 * Executes a given query and passes control flow back to the appropriate callback
	 * based on the status of the query result. This is used internally, and you can use
	 * it if you have needs not captured by one of the other methods, but it does break
	 * the abstraction layer to write queries and execute them directly. If you can't do
	 * something with the interface given, please update the wiki so that we can try to
	 * support it in a backend-agnostic way.
	 * @param query The SQL query verbatim to be executed
	 * @param success The callback to call in the event of success, accepts one argument
	 * @param failure The callback to call in the event of failure, accepts one argument
	 */
	query : function(query, success, failure) {
		var that = this;
		var hash = crypto.createHash('md5');

		// Function used to do actual processing, separated out because of crypto module differences
		var doquery = function(key) {
			var qi = that.queries[key];
			
			if (qi) {
				qi.count++;
			}
			else {
				that.queries[key] = {'count' : 1, 'sql' : query};
			}

			db.log(db.l_debug, query);
			that.conn.query(query, function(err, rows) {
				if (err) {
					failure(_.extend(err, {'query' : query}));
				}
				else {
					success(rows);
				}
			});
		};

		// If we're in version 10.x, attempt to use the stream interface
		if (process.version.match(/\d+.(10|11)/)) {
			hash.setEncoding('hex');
			hash.on('readable', function() {
				doquery(hash.read());
			});
			hash.write(query, 'utf8');
		}
		else {
			// Use the older update/digest approach
			hash.update(query, 'utf8');
			doquery(hash.digest('hex'));
		}
	},

	/**
	 * This decodes a filter object and passes back a portion of the query string
	 * suitable for use as a WHERE clause
	 * @param where Object describing the filter to generate the where clause
	 * @param options @see process for description
	 * @return String suitable for direct inclusion as a WHERE clause
	 */
	where : function(where, options) {
		var result = this.decode_filter(where, ' AND ', options);
		if (result.length > 0)
			return ' WHERE ' + result;
		return '';
	},

	/**
	 * This decodes a filter object and passes back a portion of the query string
	 * suitable for use in the SET clause of an INSERT or UPDATE statement
	 * @param values Object describing the filter to generate the values
	 * @return String suitable for direct inclusion as a SET clause
	 */
	set : function(values) {
		var result = this.decode_filter(values, ', ', {});
		if (result.length > 0)
			return ' SET ' + result;
		return '';
	},

	/**
	 * This decodes a filtering object and produces a subclause that will be joined to
	 * other clauses to form a finished query
	 * @param params Object whose keys and values will be combined as pairs to form the subclause
	 * @param sep The separator used to join the resulting terms together
	 * @param options @see process for information
	 * @return String The terms in the params object, decoded into SQL-compatible format
	 */
	decode_filter : function(params, sep, options) {
		var terms = [];
		_.each(params, this.process.bind(this, terms, options));
		return terms.join(sep);
	},

	/**
	 * This processes a key/value pair to produce an array of SQL terms for each
	 * pair. The possible options are:
	 * useName - boolean, should this table's name be emitted
	 * alias - string, if the table name is used, substitute this alias instead
	 * @param terms Array to store terms to. Arrays are passed by reference in javascript
	 * @param options Map of option values. Each value is optional
	 * @param value The value to use for the column
	 * @param key The name of the column this value is for
	 */
	process : function(terms, options, value, key) {
		if (this.special[key]) {
			this.special[key].call(this, key, value, terms, options);
		}
		else {
			if (!(value instanceof op.Conditional) && !(value instanceof op.RawFunction)) {
				if (_.isArray(value))
					value = db.$in(value);
				else if (value instanceof RegExp)
					value = db.$regex(value);
				else
					value = db.$eq(value);
			}
			terms.push(value.get(key, this, options));
		}
	},

	/**
	 * Generates the escaped key name with optional table prefixing
	 * Possible option values that are checked:
	 * useName - boolean, should this key use the table name
	 * alias - string, if this table name is used, print this alias instead
	 * @param key The key name to escape
	 * @param options The options for producing this key's representation
	 * @return String the escaped and optionally prefixed field name
	 */
	escapeKey : function(key, options) {
		var rtn = '';

		if (options.useName) {
			if (options.alias && options.alias.length > 0)
				rtn = mysql.escapeId(options.alias) + '.';
			else
				rtn = mysql.escapeId(this.table) + '.';
		}

		if (key instanceof op.Operator)
			return key.getField(this, options);
		else if (key == '*')
			return rtn + key;
		else
			return rtn + mysql.escapeId(key);
	},

	/**
	 * This escapes a built-in type to match a column name, by casting or
	 * converting it to match the format expected in MySQL
	 * @param col The name of the column this value is for
	 * @param value The value to escape
	 * @return String The escaped value exactly as it should be inserted into the query
	 */
	handle_type : function(col, value) {
		var ht = this.columns[col];
		if (ht) {
			if (ht == db.int_t)
				return parseInt(value) || 0;
			else if (ht == db.date_t)
				return this.handle_date(value);
			else if (ht == db.datetime_t || ht == db.timestamp_t)
				return this.handle_datetime(value);
			else if (_.isArray(ht)) {
				if (ht[0] == db.varchar_t || ht[0] == db.char_t) {
					return mysql.escape((value+'').substring(0, ht[1]));
				}
			}
		}
		return mysql.escape(value);
	},

	/**
	 * This converts a value to the format for the mysql Date column type, accepting a
	 * string, unix timestamp, or Date object to convert. Note we just use the js Date
	 * object to convert, so hopefully whatever you have makes sense to its constructor
	 * @param date The date to convert, as string, int timestamp, or Date object
	 * @return String the date represented as MySQL expects it for a DATE field
	 */
	handle_date : function(date) {
		if (date == 'CURDATE()' || date == 'CURRENT_DATE()')
			return date;

		if (date instanceof Date)
			return date.getFullYear() + '-' + (date.getMonth()+1) + '-' + date.getDate();
		
		return this.handle_date(new Date(date));
	},

	/**
	 * this converts a value to the format for the mysql DATETIME or TIMESTAMP columns,
	 * accepting a string, unix timestamp, or Date object to convert.
	 * @note Datetime can handle milliseconds. Mysql ignores these, so we don't bother sending them
	 * @param date The date to convert, as string, int, or Date object
	 * @return String the date represented as MySQL exepcts it for a DATETIME field
	 */
	handle_datetime : function(date) {
		if (date == 'NOW()')
			return date;

		if (date instanceof Date)
			return this.handle_date(date) + ' ' + date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds();

		return this.handle_datetime(new Date(date));
	}

});

// Expose the database class as our export, but not the query classes, because those are only produced by us
module.exports = db;
