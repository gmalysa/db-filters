/**
 * Definition of the Query-related classes that are used by each filter
 * to actually generate SQL statements
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var _ = require('underscore');
var mysql = require('mysql');

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

// Export the concrete query class definitions
module.exports.SelectQuery = SelectQuery;
module.exports.InsertQuery = InsertQuery;
module.exports.UpdateQuery = UpdateQuery;
module.exports.DeleteQuery = DeleteQuery;
