/**
 * Definition of the Operator base class, and some uncategorized special functions
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

/******************************************************************************
 * Base class of all operators, a mostly abstract class
 *****************************************************************************/
function Operator(name) {
	this.name = name;
	this.require_group = false;
}

/**
 * Access wrapper that will either return a value, or if it is a nested value,
 * will evaluate it and then return that
 * @param value The value to evaluate
 * @param key The column name of the value being retrieved
 * @param filter The filter context where we're retrieving values
 * @param options Options to be passed to the key escape function if necessary
 * @return String evaluated+escaped version of value
 */
Operator.prototype.eval = function(value, key, filter, options) {
	if (value instanceof Operator) {
		var result = value.get(key, filter, options);
		if (this.require_group)
			return '(' + result + ')';
		return result;
	}
	else {
		return filter.handle_type(key, value);
	}
};

/**
 * Abstract implementation of get throws an exception, this should be overridden in
 * derived classes
 * @param key The column name being used in this comparison
 * @param filter The filter context where we're retrieving the value
 * @param options Options to be passed to the key escaping function if necessary
 * @return String complete conditional expression
 */
Operator.prototype.get = function(key, filter, options) {
	throw new Error('Call to abstract method db-filters.Operator.get()');
};

/**
 * Abstract implementation of getField throws an exception, this should be overridden
 * in derived classes that can be used as a field in a select query
 */
Operator.prototype.getField = function(filter, options) {
	throw new Error('Call to abstract method db-filters.Operator.getField()');
};

/*******************************************************************************
 * Cheating method that can be used to insert raw strings into queries or parts
 * of queries to cover up for things that are not implemented yet. You should
 * avoid using this unless absolutely necessary, and should generally file a
 * report about your usage case so that we can add functionality to cover it
 ******************************************************************************/
function RawFunction(str) {
	Operator.call(this, '$raw');
	this.str = str;
}
RawFunction.prototype = new Operator();
RawFunction.prototype.constructor = RawFunction;

/**
 * get() implementation as a straight passthrough of the value, ignoring everything
 * @see Operator.get()
 */
RawFunction.prototype.get = function(key, filter, options) {
	return this.str;
};

/**
 * getField() behaves in the same way exactly, as a straight passthrough
 * @see Operator.getField()
 */
RawFunction.prototype.getField = function(key, filter, options) {
	return this.str;
}

/*******************************************************************************
 * The field function is used to pass through field names as arguments to
 * another function, in a situation where this would normally not be allowed.
 * One good example is passing a second field to atan2(), instead of an actual
 * value
 ******************************************************************************/
function FieldFunction(field) {
	Operator.call(this, '$field');
	this.field = field;
}
FieldFunction.prototype = new Operator();
FieldFunction.prototype.constructor = FieldFunction;

/**
 * get() passes the field to the filter for escaping, always
 * @see Operator.getField()
 */
FieldFunction.prototype.get = function(key, filter, options) {
	return filter.escapeKey((this.field === undefined) ? key : this.field, options);
}

/**
 * getField() passes back the already fixed field, always
 * @see Operator.getField()
 */
FieldFunction.prototype.getField = function(filter, options) {
	return this.get(this.field, filter, options);
}

/*******************************************************************************
 * Add special operator definitions based on the above classes
 ******************************************************************************/
var operators = {};

// Wrap the constructors in a function for consistency of interface
operators.$raw = function(str) { return new RawFunction(str); };
operators.$field = function(f) { return new FieldFunction(f); };

// Definition exports
module.exports.Operator = Operator;
module.exports.RawFunction = RawFunction;
module.exports.operators = operators;
