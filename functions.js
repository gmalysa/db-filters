/**
 * Definition of operator functions that do not produce complete expressions--in general,
 * these can be used anywhere: in field definitions, inside where clauses, etc.
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var mysql = require('mysql');
var op = require('./operator_base');

/*******************************************************************************
 * Base class for functions that take a single parameter, which is either a field
 * or a value, depending on usage
 ******************************************************************************/
function UnaryFunction(fn, val) {
	this.fn = fn;
	this.value = val;
}
UnaryFunction.prototype = new op.Operator();
UnaryFunction.prototype.constructor = UnaryFunction;

/**
 * Implementation of get(), when this is used in a where clause, will apply
 * itself to the field given if no value was given, otherwise it will
 * wrap the value given.
 * @see Operator.get()
 */
UnaryFunction.prototype.get = function(key, filter, options) {
	if (this.value !== undefined)
		return this.fn + '(' + filter.escapeKey(key, options) + ')';
	else
		return this.fn + '(' + this.eval(this.value, key, filter, options) + ')';
};

/**
 * Implementation of getField(), which requires that a value was supplied
 * @see Operator.getField()
 */
UnaryFunction.prototype.getField = function(filter, options) {
	return this.fn + '(' + filter.escapeKey(this.value, options) + ')';
};

/*******************************************************************************
 * Base class for functions that take two parameters, one of which is a field and
 * the other of which is a literal value. Also supports field passthrough when
 * used in a where clause
 ******************************************************************************/
function BinaryFunction(fn, field, val) {
	this.fn = fn;
	this.field = field;
	this.value = val;
}
BinaryFunction.prototype = new op.Operator();
BinaryFunction.prototype.constructor = BinaryFunction;

/*******************************************************************************
 * @see Operator.get()
 ******************************************************************************/
BinaryFunction.prototype.get = function(key, filter, options) {
};

/*******************************************************************************
 * @see Operator.getField()
 ******************************************************************************/
BinaryFunction.prototype.getField = function(filter, options) {
};

/*******************************************************************************
 * Create complete list of operators/functions/etc. defined here and export it
 ******************************************************************************/
var operators = {};

// Unary function information
// @todo Add math functions
var unary_functions = [
	['$count', 'COUNT'], ['$length', 'LENGTH'], ['$char_length', 'CHAR_LENGTH'],
	['$trim', 'TRIM'], ['$ltrim', 'LTRIM'], ['$rtrim', 'RTRIM'],
	['$soundex', 'SOUNDEX'], ['$reverse', 'REVERSE'], ['$lcase', 'LOWER'],
	['$ucase', 'UPPER']];
unary_functions.map(function(v) {
	operators[v[0]] = function(value) {
		return new UnaryFunction(v[1], value);
	};
});

// Finally, export operators from the module, but no need for classes
module.exports.operators = operators;
