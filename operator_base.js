/**
 * Definition of the Operator base class
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

/******************************************************************************
 * Base class of all operators, a mostly abstract class
 *****************************************************************************/
function Operator() {}

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
		return '('+value.get(key, filter, options)+')';
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

// Definition exports
module.exports.Operator = Operator;
