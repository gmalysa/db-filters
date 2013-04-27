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
 * See LICENSE for information about the MIT License
 */

var _ = require('underscore');
var mysql = require('mysql');
var crypto = require('crypto');
var fs = require('fs');

var logger = require('./logger');

/**
 * Constructor for the db filter takes options to define the table that it will be
 * used to filter
 * @param table The name of the table
 * @param columns Any non-string columns that should be handled with a built-in
 * @param special Any special fields that will be handled externally with a callback
 */
function db(table, columns, special) {
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
	
	// Logging levels
	l_debug : 3,			//!< Provides debugging-quality output, including verbose query information and incorrect usage info (i.e. calling limit() on an InsertQuery)
	l_info : 2,				//!< Provides informative output, like query strings
	l_error : 1,			//!< Provides only error messages received from the server
	l_none : 0,				//!< Provides no logging at all

	// Static information about logging
	fn_log : null,			//!< Callback for logging, takes one parameter, the message
	log_level : db.l_none,	//!< Default log level

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
			// it as a static property on database
			var filter = require(path+'/'+f);
			filter(db);
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
	}

});

// Member/instance data definition
_.extend(db.prototype, {
	table : '',			//!< Table name
	columns : {},		//!< Non-string columns of built-in type
	special : {},		//!< Special fields and their handlers
	queries : {},		//!< Queries that have been executed, for stats and information
	conn : null,		//!< The connection to use for SQL query execution

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
	 * @param negate Array used to specify any negative relationships in the where, optional
	 */
	select : function(where, negate) {
		negate = negate || [];
		return new SelectQuery(this, where, negate);
	},

	/**
	 * Creates and executes an INSERT query for the options given
	 * @param values The object to be inserted to the db
	 */
	insert : function(values) {
		return new InsertQuery(this, values);
	},

	/**
	 * Creates and executes an UPDATE query for the options given
	 * @param update The new values to be written
	 * @param where Object used to specify what to update
	 * @param negate Any inverted relationships in where, optional
	 */
	update : function(update, where, negate) {
		negate = negate || [];
		return new UpdateQuery(this, update, where, negate);
	},

	/**
	 * Creates and executes a DELETE query for the options given
	 * @param where Object specifying what to delete
	 * @param negate Any inverted relationships in where, optional
	 */
	delete : function(where, negate) {
		negate = negate || [];
		return new DeleteQuery(this, where, negate);
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
	 * @param negate Array of keys to represent with a negative relationship
	 * @param useName Should the table name be prefixed onto the key values?
	 * @return String suitable for direct inclusion as a WHERE clause
	 */
	where : function(where, negate, useName) {
		var result = this.decode_filter(where, negate, ' AND ', useName);
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
		var result = this.decode_filter(values, [], ', ', false);
		if (result.length > 0)
			return ' SET ' + result;
		return '';
	},

	/**
	 * This decodes a filtering object and produces a subclause that will be joined to
	 * other clauses to form a finished query
	 * @param params Object whose keys and values will be combined as pairs to form the subclause
	 * @param negate Array of key names whose relationship should be inverted
	 * @param sep The separator used to join the resulting terms together
	 * @param useName Should the table name be included in field names?
	 * @return String The terms in the params object, decoded into SQL-compatible format
	 */
	decode_filter : function(params, negate, sep, useName) {
		var terms = [];
		var that = this;

		_.each(params, function(v, k) {
			var invert = negate[k] ? true : false;
			that.process(k, v, invert, terms, useName);
		});

		return terms.join(sep);
	},

	/**
	 * This processes a key/value pair to produce an array of SQL terms for each
	 * pair.
	 * @param key The name of the column this value is for
	 * @param value The value to use for the column
	 * @param negate Should the relationship be inverted (i.e. IN becomes NOT IN)
	 * @param terms Array to store terms to. Arrays are passed by reference in javascript
	 * @param useName Should the table name be used when printing field names?
	 */
	process : function(key, value, negate, terms, useName) {
		if (this.special[key]) {
			this.special[key].call(this, key, value, negate, terms, useName);
		}
		else if (_.isArray(value)) {
			var values = _.map(value, _.bind(handle_type, this, key));
			if (values.length > 0)
				terms.push(this.escapeKey(key, useName) + (negate ? 'NOT IN (' : 'IN (') + values.join(', ') + ')');
		}
		else {
			terms.push(this.escapeKey(key, useName) + (negate ? ' != ' : ' = ') + this.handle_type(key, value));
		}
	},

	/**
	 * Generates the escaped key name with optional table prefixing
	 * @param key The key name to escape
	 * @param prefix Should the key/field be prefixed with table name?
	 * @return String the escaped and optionally prefixed field name
	 */
	escapeKey : function(key, prefix) {
		var rtn = '';
		if (prefix) {
			rtn = mysql.escapeId(this.table) + '.';
		}
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
				if (ht[0] == db.varchar_t) {
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

/**
 * Query class used to make the interface make more logical sense
 * @param filter The db filter instance that defines the table this query acts on
 */
function Query(filter) {
	this.db = filter;
}

/**
 * Default, "not supported" method. This doesn't throw an error, because that'd break
 * user callback chains in a really annoying way, but it will log to the filter's logging
 * mechanism, which can be helpful for tracking down errors.
 */
function not_supported() {
	db.log(db.l_error, 'This function (' + arguments.callee + ') is not implemented for ' + this.constructor.name);
}

// Add member functions to the query definition
_.extend(Query.prototype, {
	db : null,				//!< Filter instance that is used to decode arguments
	useTableName : false,	//!< Should the table name be used when giving column names in the query? (should be true for joins)
	isJoin : false,			//!< Is this a join query now?
	_where : {},			//!< Key used to define where clauses
	_negate : [],			//!< Array of fields to negate
	_limit : [],			//!< List of limit parameters
	_joins : [],			//!< List of joined tables
	_on : [],				//!< Array of join ON criteria

	/**
	 * These three exist for the SELECT query only, so we don't provide global implementations
	 */
	group : not_supported,
	fields : not_supported,
	order : not_supported,

	/**
	 * How each query is built depends on the type of query, so we must defer that to the implementing subclass
	 */
	buildQuery : not_supported,

	/**
	 * Helper function that retrieves the where clause using the specified db filter to aid in construction
	 * @return String verbatim WHERE clause, will be empty if there are no restrictions
	 */
	getWhere : function() {
		return this.db.where(this.where, this.negate, this.useTableName);
	},

	/**
	 * Helper function that turns the _limit array into a useful limit statement (used in 3 of 4 queries)
	 * @return String verbatim LIMIT statement, will be empty if no limits specified
	 */
	getLimit : function() {
		if (this._limit.length > 0) {
			return ' LIMIT ' + this._limit.join(', ');
		}
		return '';
	},

	/**
	 * We provide a default implementation for limit because it is used by three of the four queries that
	 * are provided, so this reduces repetition
	 * @param limits Mixed representing the limits to use. Can be an array or a literal (int or string)
	 * @return Chainable this pointer
	 */
	limit : function(limits) {
		if (_.isArray(limits)) {
			this._limit = limits;
		}
		else {
			this._limit = [limits+''];
		}
		return this;
	},

	/**
	 * We also provide a default implementation for where, because again it is used by thre of the four
	 * queries that are provided, thereby reducing repetition.
	 * @param where Key/value mapping, suitable for filter decoding, to be used for WHERE generation
	 * @param negate Array of fields that should have their where parameters negated, optional.
	 * @return Chainable this pointer
	 */
	where : function(where, negate) {
		this.where = where || {};
		this.negate = negate || [];
		return this;
	},
	
	/**
	 * Executes the query, calling methods that must be implemented in order to produce the
	 * query string, and then retrieving the connection object from the db filter given
	 * @param success Callback to invoke on success, with one argument, the results
	 * @param failure Callback to invoke on failure, with one argument, the error object
	 */
	exec : function(success, failure) {
		var query = this.buildQuery();
		this.db.query(query, success, failure);
	}

});

/**
 * DeleteQuery is used to construct a DELETE statement. It is simple and defines no additional
 * interface over the base Query class
 * @param filter The database filter to use for computing WHERE statements
 */
function DeleteQuery(filter) {
	this.db = filter;
}

// Inherit/copy methods from Query, and then fill in how to build a DELETE query
_.extend(DeleteQuery.prototype, Query.prototype, {
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'DELETE FROM ' + this.db.table + this.getWhere() + this.getLimit();
	}
});

/**
 * InsertQuery is used to construct an INSERT statement. It too is very simple, but it must
 * undefine the where and limit interfaces. The values to insert are specified in the constructor,
 * using the same decoding features as a where clause would normally do
 * @param filter The database filter to use for decoding the values
 * @param values The values to insert when this query is executed
 */
function InsertQuery(filter, values) {
	this.db = filter;
	this.values = values;
}

// Inherit/copy methods from Query, and then fill in how to build an INSERT query
_.extend(InsertQuery.prototype, Query.prototype, {
	/**
	 * Remove the unsuitable methods
	 */
	where : not_supported,
	limit : not_supported,

	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'INSERT INTO ' + this.db.table + this.db.set(this.values);
	}
});

/**
 * An UpdateQuery is used to build UPDATE queries. It is simple, but it must make two filter
 * decodings, one for the values and the other for the WHERE clause
 * @param filter The database filter to use for decoding values
 * @param values The new values to be written in place
 * @param where The update criteria
 * @param negate Any negated where relationships
 */
function UpdateQuery(filter, values, where, negate) {
	this.db = filter;
	this.values = values;
	this.where(where, negate);
}

// Inherit/copy methods from Query and then fill in how to build an UPDATE query
_.extend(UpdateQuery.prototype, Query.prototype, {
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'UPDATE ' + this.db.table + this.db.set(this.values) + this.getWhere() + this.getLimit();
	}
});

/**
 * SelectQuery is used to construct a SELECT statement
 * @param filter The database filter used to help construct this query
 * @param where The where object for this filter
 * @param negate The array of key names
 */
function SelectQuery(filter, where, negate) {
	this.db = filter;
	this.where(where, negate);
}

// Inherit/copy all of the methods from Query, and then fill in the ones we need to change
_.extend(SelectQuery.prototype, Query.prototype, {
	_fields : [],		//!< List of fields+names to populate select queries
	_group : [],		//!< List of group by parameters
	_order : [],		//!< List of order by parameters

	/**
	 * Accept parameters to be used for the GROUP BY clause
	 * @param groups Mixed, array of things to group or a single literal for grouping
	 * @return Chainable this pointer
	 */
	group : function(groups) {
		if (_.isArray(groups)) {
			this._group = this._group.concat(groups);
		}
		else {
			this._group = this._group.concat([groups]);
		}
		return this;
	},

	/**
	 * Accept a list of fields that should be used for the select query. Fields may be included
	 * with an optoinal alias as well, which should be specified as an array in that case.
	 * @param fields Array of fields to add, which should be strings or arrays of two strings
	 * @return Chainable this pointer
	 */
	fields : function(fields) {
		this._fields = this._fields.concat(fields);
		return this;
	},

	/**
	 * Accept a list of things for the order by clause, as an array. Optionally, if ascending/descending
	 * order should be specified (i.e. not default), then the option should be an array with the field name
	 * in the 0th index, and either ASC or DESC in the 1st index.
	 * @param orders Array of order by subclauses to include
	 * @return Chainable this pointer
	 */
	order : function(orders) {
		this._order = this._order.concat(orders);
		return this;
	},

	/**
	 * Joins another table to this query. If the join type is not specified, then it defaults
	 * to a LEFT JOIN.
	 * @param filter The filter to join against. This should be an instance of the db class
	 * @param type The join type, optional, defaults to 'LEFT,' but may be INNER or RIGHT as well
	 * @return Chainable this pointer
	 */
	join : function(filter, type) {
		type = type || 'LEFT';
		this._joins.push({
			'filter' : filter,
			'type' : type
		});
		this.isJoin = true;
		this.useTableName = true;
		return this;
	},

	/**
	 * Specifies the ON condition for the join. Each argument is taken as a pair of conditions and
	 * should be an object whose key indicates the numerical index of the table and whose value is the
	 * field to be specified. For instance, on(['id', 'userId']) would specify one ON clause comparing
	 * t0.id to t1.userId. Mutliple conditions can be chained with successive calls to on() or by passing
	 * them as additional parameters
	 * @param varargs, Each is an array of ON details
	 * @return Chainable this pointer
	 */
	on : function() {
		var that = this;
		logger.var_dump(arguments);
		_.each(Array.prototype.slice.call(arguments), function(v) {
			logger.debug('', 'Pushed on clause');
			that._on.push(v);
		});
		logger.var_dump(this._on);
		return this;
	},

	/**
	 * Returns the group by clause or an empty string if one isn't present
	 * @return String the GROUP BY part of this select statement
	 */
	getGroupBy : function() {
		if (this._group.length > 0) {
			return ' GROUP BY ' + this._group.join(', ');
		}
		return '';
	},

	/**
	 * Returns the order by clause or an empty string if one isn't present
	 * @return String the ORDER BY part of this select statement
	 */
	getOrderBy : function() {
		if (this._order.length > 0) {
			return ' ORDER BY ' + _.map(this._order, function(v) {
				if (_.isArray(v))
					return v[0] + ' ' + v[1];
				return v;
			}).join(', ');
		}
		return '';
	},

	/**
	 * Returns the fields, or * if no fields were specified. Also supports
	 * renaming fields if they are passed as an array
	 * @return String the select fields listing for this query
	 */
	getFields : function() {
		if (this._fields.length > 0) {
			return _.map(this._fields, function(v) {
				if (_.isArray(v))
					return v[0] + ' AS ' + v[1];
				return v;
			}).join(', ');
		}
		return '*';
	},

	/**
	 * Retrieves the ON clause that comes up in a join expression
	 * @param tables The names of the tables indexed in the proper order for inclusion
	 * @return String the ON clause, empty if there isn't a join happening
	 */
	getOnClause : function(tables) {
		if (this._on.length > 0) {
			// Probably the most functional-ish piece of code I've ever written
			// Map each _on entry to ... and separated by a ,
			return ' ON ' + _.map(this._on, function(v) {
				// its values mapped to ... and separated by an =
				return _.map(v, function(v, k) {
					// the table name for the key and the escaped identifier
					return tables[k] + '.' + mysql.escapeId(v);
				}).join(' = ');
			}).join(' AND ');

			// I.e. this turns [['id', 'userId'], {0:'id', 2:'adminId'}] into
			// ON t0.`id` = t1.`userId`, t0.`id` = t2.`adminId`
		}
		return '';
	},

	/**
	 * Returns the table name portion of the select statement, which will either be
	 * just the one table, or expand to include all the proper subclauses for the
	 * join statement
	 * @return String table name portion of query
	 */
	getTableName : function() {
		var filters = [this.db].concat(_.map(this._joins, function(v) { return v.filter; }));
		var tableNames = _.map(filters, function(v) { return v.table; });
		var tables = [this.db.table].concat(_.map(this._joins, function(v) {
			return v.type + ' JOIN ' + v.filter.table;
		}));

		return tables.join(' ') + this.getOnClause(tableNames);
	},
	
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'SELECT ' + this.getFields() + ' FROM ' + this.getTableName() + this.getWhere() + this.getGroupBy() + this.getOrderBy() + this.getLimit();
	}
	
});

// Expose the database class as our export, but not the query classes, because those are only produced by us
module.exports = db;

