/**
 * Automatic query generation tools to simplify writing SQL and interacting with
 * databases. Currently, this supports MySQL, but ideally it'd be able to generate
 * valid queries for a wide variety of databases, facilitating backend changes.
 */

var _ = require('underscore');
var mysql = require('mysql');
var crypto = require('crypto');

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
	int_t : 1,
	date_t : 2,
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
	 * @param negate Array used to specify any negative relationships in the where
	 * @param options Object suitable for passing to SelectParser to read out query options
	 * @param success Callback to be called with the query results
	 * @param failure Callback to be called in the event of an error
	 */
	select : function(where, negate, options, success, failure) {
		var query = this.create_select(where, negate, options);
		this.query(query, success, failure);
	},

	/**
	 * Creates and executes an INSERT query for the options given
	 * ...
	 */
	insert : function(values, success, failure) {
		var query = this.create_insert(values);
		this.query(query, success, failure);
	},

	/**
	 * Creates and executes an UPDATE query for the options given
	 * ...
	 */
	update : function(update, where, negate, success, failure) {
		var query = this.create_update(update, where, negate);
		this.query(query, success, failure);
	},

	/**
	 * Creates and executes a DELETE query for the options given
	 * ...
	 */
	delete : function(where, negate, success, failure) {
		var query = this.create_delete(where, negate);
		this.query(query, success, failure);
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

		// Node 0.8.20 version active
		hash.update(query, 'utf8');
		var key = hash.digest('hex');

		// Node 0.10.4 crypto version commented
//		hash.on('readable', function() {
//			var key = hash.read();
			var qi = that.queries[key];
			
			if (qi) {
				qi.count++;
			}
			else {
				that.queries[key] = {'count' : 1, 'query' : query};
			}

			this.conn.query(query, function(err, rows) {
				if (err) {
					failure(err);
				}
				else {
					success(rows);
				}
			});
//		});

//		hash.write(query, 'utf8');
	},

	/**
	 * Create a SELECT-type query by processing all of the fields in the aggregate object
	 * given
	 * @param options Object whose keys correspond to features in the query
	 * @return String the SQL query string
	 */
	create_select : function(where, negate, options) {
		var sp = new SelectParser(options);
		return 'SELECT ' + sp.fields() + ' FROM ' + this.table + this.where(where, negate) + sp.group() + sp.order() + sp.limit();
	},

	/**
	 * Creates an INSERT-type query from the parameters given
	 * @param insert The object whose key/value pairs will be converted into SQL to insert
	 * @return String the INSERT query to be executed by MySQL
	 */
	create_insert : function(insert) {
		return 'INSERT INTO ' + this.table + this.set(insert);
	},

	/**
	 * Creates a DELETE-type query from the parameters given
	 * @param del Object whose key/value pairs will be converted into SQL to delete
	 * @param negate Array of keys whose relationship with their values should be negated
	 * @return String the DELETE query to be executed by MySQL
	 */
	create_delete : function(del, negate) {
		return 'DELETE FROM ' + this.table + this.where(del, negate);
	},

	/**
	 * Creates an UPDATE-type query from the parameters given
	 * @param update Object with new values to update
	 * @param where Object used to select fields to update
	 * @param negate Array used to negate keys in the where clause
	 * @return String the UPDATE query to be executed by MySQL
	 */
	create_update : function(update, where, negate) {
		return 'UPDATE ' + this.table + this.set(update) + this.where(where, negate);
	},
	
	/**
	 * This decodes a filter object and passes back a portion of the query string
	 * suitable for use as a WHERE clause
	 * @param where Object describing the filter to generate the where clause
	 * @param negate Array of keys to represent with a negative relationship
	 * @return String suitable for direct inclusion as a WHERE clause
	 */
	where : function(where, negate) {
		var result = this.decode_filter(where, negate, ' AND ');
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
		var result = this.decode_filter(values, [], ', ');
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
	 * @return String The terms in the params object, decoded into SQL-compatible format
	 */
	decode_filter : function(params, negate, sep) {
		var terms = [];
		var that = this;

		_.each(params, function(v, k) {
			var invert = negate[k] ? true : false;
			that.process(k, v, invert, terms);
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
	 */
	process : function(key, value, negate, terms) {
		if (this.special[key]) {
			this.special[key].call(this, key, value, negate, terms);
		}
		else if (_.isArray(value)) {
			var values = _.map(value, _.bind(handle_type, this, key));
			if (values.length > 0)
				terms.push(mysql.esapeId(key) + (negate ? 'NOT IN (' : 'IN (') + values.join(', ') + ')');
		}
		else {
			terms.push(mysql.escapeId(key) + (negate ? ' != ' : ' = ') + this.handle_type(key, value));
		}
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
		}
		return '"' + mysql.escape(value) + '"';
	},

	/**
	 * This converts a value to the format for the mysql Date column type, accepting a
	 * string, unix timestamp, or Date object to convert
	 * @param date The date to convert, as string, int timestamp, or Date object
	 * @return String the date represented as MySQL expects it for a DATE field
	 * @todo Actually implement the date function
	 */
	handle_date : function(date) {
		return '';
	}

});

/**
 * This class is used to parse each of the potential options that can be given for a SELECT query
 * allowing us to avoid some really awkward function signatures while maintaining flexibility.
 * @param db The db filter for the table that we're generating a SELECT for
 * @param options The object of options for this query to be constructed with
 */
function SelectParser(options) {
	this.options = options || {};
}

// Member/instance functions
_.extend(SelectParser.prototype, {
	fields : function() {
		if (this.options.fields) {
			return _.map(this.options.fields, function(v) {
				if (_.isArray(v))
					return v[0] + ' AS ' + v[1];
				return v[0];
			}).join(', ');
		}
		return '*';
	},

	group : function() {
		if (this.options.group)
			if (_.isArray(this.options.group))
				return ' GROUP BY ' + this.options.group.join(', ');
			else
				return ' GROUP BY ' + this.options.group;
		return '';
	},

	order : function() {
		if (this.options.order)
			if (_.isArray(this.options.order))
				return ' ORDER BY ' + this.options.order.join(', ');
			else
				return ' ORDER BY ' + this.options.order;
		return '';
	},

	limit : function() {
		if (this.options.limit)
			if (_.isArray(this.options.limit))
				return ' LIMIT ' + this.options.limit.join(', ');
			else
				return ' LIMIT ' + this.options.limit;
		return '';
	}
});

// Expose the database class as our export
module.exports = db;