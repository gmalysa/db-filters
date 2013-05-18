/**
 * Exposes all of the operator definitions, which are spread around multiple files
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var _ = require('underscore');
var op = require('./operator_base');
var c = require('./conditionals');
var f = require('./functions');

module.exports.Operator = op.Operator;
module.exports.operators = _.extend({}, op.operators, c.operators, f.operators);
