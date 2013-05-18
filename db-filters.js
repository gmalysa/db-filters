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

var op = require('./operators');

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
	 * @return Query object that can have its properties modified before executing
	 */
	select : function(where) {
		return new SelectQuery(this, where);
	},

	/**
	 * Creates and executes an INSERT query for the options given
	 * @param values The object to be inserted to the db
	 * @return Query object that can have its properties modified before executing
	 */
	insert : function(values) {
		return new InsertQuery(this, values);
	},

	/**
	 * Creates and executes an UPDATE query for the options given
	 * @param update The new values to be written
	 * @param where Object used to specify what to update
	 * @return Query object that can have its properties modified before executing
	 */
	update : function(update, where) {
		return new UpdateQuery(this, update, where);
	},

	/**
	 * Creates and executes a DELETE query for the options given
	 * @param where Object specifying what to delete
	 * @return Query object that can have its properties modified before executing
	 */
	delete : function(where) {
		return new DeleteQuery(this, where);
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
			if (!(value instanceof op.Conditional)) {
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
			return rtn + key.getField(this, options);
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
	this.db = filter;					//!< Filter instance that is used to decode arguments
	this._options = {					//!< Options array that will be passed to decode_filter()
		useName : false,
		alias : ''
	};
	this._where = {};					//!< Key used to define where clauses
	this._limit = [];					//!< List of limit parameters
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
		return this.db.where(this._where, this._options);
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
			this._limit = [limits];
		}
		return this;
	},

	/**
	 * We also provide a default implementation for where, because again it is used by three of the four
	 * queries that are provided, thereby reducing repetition.
	 * @param where Key/value mapping, suitable for filter decoding, to be used for WHERE generation
	 * @return Chainable this pointer
	 */
	where : function(where) {
		this._where = where || {};
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
DeleteQuery.prototype = new Query();
function DeleteQuery(filter) {
	Query.call(this, filter);
}

// Inherit/copy methods from Query, and then fill in how to build a DELETE query
DeleteQuery.prototype.constructor = DeleteQuery;
_.extend(DeleteQuery.prototype, {
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
InsertQuery.prototype = new Query();
function InsertQuery(filter, values) {
	Query.call(this, filter);
	this.values = values;
}

// Inherit/copy methods from Query, and then fill in how to build an INSERT query
InsertQuery.prototype.constructor = InsertQuery;
_.extend(InsertQuery.prototype, {
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
 */
UpdateQuery.prototype = new Query();
function UpdateQuery(filter, values, where) {
	Query.call(this, filter);
	this.values = values;
	this.where(where);
}

// Inherit/copy methods from Query and then fill in how to build an UPDATE query
UpdateQuery.prototype.constructor = UpdateQuery;
_.extend(UpdateQuery.prototype, {
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
 */
SelectQuery.prototype = new Query();
function SelectQuery(filter, where) {
	Query.call(this, filter);
	this.where(where);

	this._fields = [];		//!< List of fields+names to populate select queries
	this._group = [];		//!< List of group by parameters
	this._order = [];		//!< List of order by parameters
	this._joins = [];		//!< List of table joins to apply
}

// Inherit/copy all of the methods from Query, and then fill in the ones we need to change
SelectQuery.prototype.constructor = SelectQuery;
_.extend(SelectQuery.prototype, {
	/**
	 * Select uses a special where option that allows things to be specified per join index
	 * @param idx The joined table number. The first joined table is index 0
	 * @param where Key/value mapping, suitable for filter decoding, to be used for WHERE generation
	 * @return Chainable this pointer
	 */
	where : function(idx, where) {
		if (typeof idx == 'number')
			this._joins[idx].where = where || {};
		else
			this._where = arguments[0] || {};
		return this;
	},

	/**
	 * Accept parameters to be used for the GROUP BY clause
	 * @param groups Mixed, array of things to group or a single literal for grouping
	 * @return Chainable this pointer
	 */
	group : function(groups) {
		if (_.isArray(groups))
			this._group = this._group.concat(groups);
		else
			this._group = this._group.concat([groups]);
		return this;
	},

	/**
	 * Sets the alias for this table or a joined table
	 * @param join Join index, optional, will apply the alias to this table
	 * @param alias The string alias to use for this table in the query
	 * @return Chainable this pointer.
	 */
	alias : function(join, alias) {
		if (typeof join == 'number')
			this._joins[join].alias = alias;
		else
			this._options.alias = arguments[0];
		return this;
	},

	/**
	 * Accept a list of fields that should be used for the select query. Fields may be included
	 * with an optoinal alias as well, which should be specified as an array in that case.
	 * @param join Join index, optional, will apply these field selections to the given join
	 * @param varargs, each is processed as a single field, whether literal or array type
	 * @return Chainable this pointer
	 */
	fields : function(join, fields) {
		if (typeof join == 'number')
			this._joins[join].fields = this._joins[join].fields.concat(Array.prototype.slice.call(arguments, 1));
		else
			this._fields = this._fields.concat(Array.prototype.slice.call(arguments));
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
	 * to an INNER JOIN, because they do not require ON clauses to be specified (LEFT does).
	 * The filter can be given as an array of [filter, alias], or as a filter instance directly
	 * @param filter Mixed The filter to join against. This should be an instance of the db class or an array
	 * @param type The join type, optional, defaults to 'LEFT,' but may be INNER or RIGHT as well
	 * @return Chainable this pointer
	 */
	join : function(filter, type) {
		var alias = '';
		type = type || 'INNER';
		if (_.isArray(filter)) {
			alias = filter[1];
			filter = filter[0];
		}

		this._joins.push({
			'filter' : filter,
			'type' : type,
			'on' : [],
			'fields' : [],
			'where' : {},
			'options' : {
				'useName' :  true,
				'alias' : alias
			}
		});
		this._options.useName = true;
		return this;
	},

	/**
	 * Specifies the ON condition for the join. Each argument is taken as a pair of conditions and
	 * should be an object whose key indicates the numerical index of the table and whose value is the
	 * field to be specified. For instance, on(['id', 'userId']) would specify one ON clause comparing
	 * t0.id to t1.userId. Mutliple conditions can be chained with successive calls to on() or by passing
	 * them as additional parameters
	 * @param join Integer join number to apply this on to, optional. Defaults to the latest added.
	 * @param varargs, Each is an array of ON details
	 * @return Chainable this pointer
	 */
	on : function() {
		var varargs;
		var join = this._joins[this._joins.length-1];
		if (typeof arguments[0] == 'number') {
			varargs = Array.prototype.slice.call(arguments, 1);
			join = this._joins[arguments[0]];
		}
		else {
			varargs = Array.prototype.slice.call(arguments);
		}

		join.on = join.on.concat(varargs);
		return this;
	},

	/**
	 * Gets this query's table name, accounting for aliasing. If index is omitted, the alias is
	 * returned for the primary table, otherwise it is the idx-th joined table.
	 * @param idx Int optional join index
	 * @return String table name or alias
	 */
	getTableAlias : function(idx) {
		if (typeof idx == 'number') {
			if (this._joins[idx].options.alias.length > 0)
				return this._joins[idx].options.alias;
			return this._joins[idx].filter.table;
		}

		if (this._options.alias.length > 0)
			return this._options.alias;
		return this.db.table;
	},

	/**
	 * Update the getWhere() method to support concatenating where clauses from tables that are
	 * joined onto this query. This means we have to call decode filter directly, rather than using
	 * the convenience wrapper, because we're reimplementing that on a higher level
	 * @return WHERE clause that can be concatenated immediately
	 */
	getWhere : function() {
		var wheres = [this.db.decode_filter(this._where, ' AND ', this._options)];
		_.each(this._joins, function(v) {
			var clause = v.filter.decode_filter(v.where, ' AND ', v.options);
			if (clause.length > 0)
				wheres.push(clause);
		}, this);

		var where = wheres.join(' AND ');
		if (where.length > 0)
			return ' WHERE ' + where;
		return '';
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
	 * Returns the fields, or * if no fields were specified for one table. Also supports
	 * renaming fields if they are passed as an array
	 * @param fields Array of field information to parse
	 * @param filter The filter that is used to escape/process the table field names
	 * @param alias String Optional table alias to prepend field names with
	 * @return String the fields
	 */
	getTableFields : function(fields, filter, alias) {
		var opts = {
			useName : (alias.length > 0),
			alias : alias
		};

		if (fields.length > 0) {
			return fields.map(function(v) {
				if (_.isArray(v))
					return filter.escapeKey(v[0], opts) + ' AS ' + v[1];
				return filter.escapeKey(v, opts);
			}).join(', ');
		}

		return filter.escapeKey('*', opts);
	},

	/**
	 * Returns the fields used for this query. Combines field selections from all tables
	 * that are joined together, retrieving fields for each one. If we're not doing a join,
	 * then the table alias is left off of the fields, because it is unnecessary
	 * @return Complete fields listing for this query
	 */
	getFields : function() {
		if (this._joins.length > 0) {
			var fields = [this.getTableFields(this._fields, this.db, this.getTableAlias())];
			return fields.concat(_.map(this._joins, function(v, k) {
				return this.getTableFields(v.fields, v.filter, this.getTableAlias(k));
			}, this)).join(', ');
		}
		return this.getTableFields(this._fields, this.db, '');
	},

	/**
	 * Retrieves the ON clause that comes up in a join expression
	 * @param tables The names of the tables indexed in the proper order for inclusion
	 * @return String the ON clause, empty if there isn't a join happening
	 */
	getOnClause : function(on, tables) {
		if (on.length > 0) {
			// Probably the most functional-ish piece of code I've ever written
			// Map each _on entry to ... and separated by a ,
			return ' ON ' + _.map(on, function(v) {
				// its values mapped to ... and separated by an =
				return _.map(v, function(v, k) {
					// the table name for the key and the escaped identifier
					return mysql.escapeId(tables[k]) + '.' + mysql.escapeId(v);
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
	getTableNameClause : function() {
		// Create primary table reference
		var tables = [this.db.table + (this._options.alias.length > 0 ? ' AS ' + this._options.alias : '')];
		
		if (this._joins.length > 0) {
			// Because we're joining, construct a list of table names/aliases for ON generation
			var tableNames = [this.getTableAlias()].concat(_.map(this._joins, function(v, k) {
				return this.getTableAlias(k);
			}, this));

			// Add entries for joined tables
			tables = tables.concat(_.map(this._joins, function(v) {
				return v.type + ' JOIN ' + v.filter.table + (v.options.alias.length > 0 ? ' AS '+v.options.alias : '') + this.getOnClause(v.on, tableNames);
			}, this));
		}

		return tables.join(' ');
	},
	
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'SELECT ' + this.getFields() + ' FROM ' + this.getTableNameClause() + this.getWhere() + this.getGroupBy() + this.getOrderBy() + this.getLimit();
	}
	
});

// Expose the database class as our export, but not the query classes, because those are only produced by us
module.exports = db;

