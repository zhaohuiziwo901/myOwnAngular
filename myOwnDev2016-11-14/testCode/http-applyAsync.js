/**
 * Created by lenovo on 2017/2/16.
 */
// http backend
function $HttpBackendProvider() {
    this.$get = function() {
        return function(method, url, post, callback, headers, timeout, withCredentials) {
            var xhr = new window.XMLHttpRequest();
            var timeoutId;
            // 第三个参数，是否异步
            xhr.open(method, url, true);
            _.forEach(headers, function(value, key) {
                xhr.setRequestHeader(key, value);
            });
            if (withCredentials) {
                xhr.withCredentials = true;
            }
            xhr.send(post || null);
            xhr.onload = function() {
                // 清除超时处理
                if (!_.isUndefined(timeoutId)) {
                    clearTimeout(timeoutId);
                }
                var response = ('response' in xhr) ? xhr.response :
                    xhr.responseText;
                var statusText = xhr.statusText || '';
                callback(xhr.status, response, xhr.getAllResponseHeaders(), statusText);
            };
            xhr.onerror = function() {
                // 清除超时处理
                if (!_.isUndefined(timeoutId)) {
                    clearTimeout(timeoutId);
                }
                callback(-1, null, '');
            };
            if (timeout && timeout.then) {
                timeout.then(function() {
                    xhr.abort();
                });
            } else if (timeout > 0) {
                timeoutId = setTimeout(function() {
                    xhr.abort();
                }, timeout);
            }
        };
    };
}

// http
function $httpProvider(){
    this.$get = ['$httpBackend', '$q', '$rootScope', '$injector', function($httpBackend, $q, $rootScope, $injector) {
        // 拦截器
        // 拦截器是一个对象，该对象有4个key：equest, requestError, response, and responseError，这四个key的值分别是四个在不同时刻执行的函数
        var interceptorFactories = this.interceptors = [];

        var useApplyAsync = false;
        this.useApplyAsync = function(value) {
            if (_.isUndefined(value)) {
                return useApplyAsync;
            } else {
                useApplyAsync = !!value;
                return this;
            }
        };

        var interceptors = _.map(interceptorFactories, function(fn) {
            // return fn();
            // return $injector.invoke(fn);
            return _.isString(fn) ? $injector.get(fn) : $injector.invoke(fn);
        });

        var defaults = this.defaults = {
            headers: {
                // 所有的请求都应该有Accept请求头，用于告诉服务器客户端希望得到的数据格式优先为json，其次是文本
                common: {
                    Accept: 'application/json, text/plain, */*'
                },
                // 有数据传递的POST请求应该有Content-Type请求头，而GET请求由于不需要请求主体，因此不需要Content-Type请求头
                // 没有数据传递的POST请求由于没有请求主体，也不应该有Content-Type请求头，这个处理放在了$http函数内
                post: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                put: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                patch: {
                    'Content-Type': 'application/json;charset=utf-8'
                }
            },
            // 将请求参数变为字符串json格式
            transformRequest: [function (data) {
                // if (_.isObject(data)) {
                if (_.isObject(data) && !isBlob(data) && !isFile(data) && !isFormData(data)) {
                    return JSON.stringify(data);
                } else {
                    return data;
                }
            }],
            transformResponse: [defaultHttpResponseTransform],
            // GET请求参数预处理函数
            // paramSerializer: serializeParams
            paramSerializer: '$httpParamSerializer'
        };

        function defaultHttpResponseTransform(data, headers) {
            if (_.isString(data)) {
                var contentType = headers('Content-Type');
                // if (contentType && contentType.indexOf('application/json') === 0) {
                if ((contentType && contentType.indexOf('application/json') === 0) || isJsonLike(data)) {
                    return JSON.parse(data);
                }
            }
            return data;
        }

        function isJsonLike(data) {
            // return data.match(/^\{/) || data.match(/^\[/);
            // 避免双花括号{{aaa}}的情况
            if (data.match(/^\{(?!\{)/)) {
                return data.match(/\}$/);
            } else if (data.match(/^\[/)) {
                return data.match(/\]$/);
            }
        }

        function isBlob(object) {
            return object.toString() === '[object Blob]';
        }

        function isFile(object) {
            return object.toString() === '[object File]';
        }

        function isFormData(object) {
            return object.toString() === '[object FormData]';
        }

        function sendReq(config, reqData) {
            var deferred = $q.defer();
            $http.pendingRequests.push(config);
            deferred.promise.then(function() {
                _.remove($http.pendingRequests, config);
            }, function() {
                _.remove($http.pendingRequests, config);
            });

            function done(status, response, headersString, statusText) {
                status = Math.max(status, 0);
                function resolvePromise() {
                    deferred[isSuccess(status) ? 'resolve' : 'reject']({
                        status: status,
                        data: response,
                        statusText: statusText,
                        headers: headersGetter(headersString),
                        config: config
                    });
                }
                // 如果开启了异步脏检测轮训机制，则调用$applyAsync方法进行脏检测，这样做的好处是在请求非常多的时候可以等很多请求都有响应之后仅执行一次脏检测从而使视图更新，不必在每个请求有响应后就执行一次脏检测循环
                if (useApplyAsync) {
                    $rootScope.$applyAsync(resolvePromise);
                } else {
                    resolvePromise();
                    if (!$rootScope.$$phase) {
                        $rootScope.$apply();
                    }
                }
            }

            // var url = buildUrl(config.url, serializeParams(config.params));
            var url = buildUrl(config.url, config.paramSerializer(config.params));
            $httpBackend(
                config.method,
                url, // config.url,
                reqData,
                done,
                config.headers,
                config.timeout,
                config.withCredentials
            );
            return deferred.promise;
        }

        function buildUrl(url, serializedParams) {
            if (serializedParams.length) {
                url += (url.indexOf('?') === -1) ? '?' : '&';
                url += serializedParams;
            }
            return url;
        }

        function serverRequest(config){
            // if (_.isString(config.paramSerializer)) {
            //     config.paramSerializer = $injector.get(config.paramSerializer);
            // }
            if (_.isUndefined(config.withCredentials) && !_.isUndefined(defaults.withCredentials)) {
                config.withCredentials = defaults.withCredentials;
            }
            var reqData = transformData(
                config.data,
                headersGetter(config.headers),
                undefined,
                config.transformRequest
            );
            if (_.isUndefined(reqData)) {
                _.forEach(config.headers, function (v, k) {
                    if (k.toLowerCase() === 'content-type') {
                        delete config.headers[k];
                    }
                });
            }

            function transformResponse(response) {
                if (response.data) {
                    response.data = transformData(
                        response.data,
                        response.headers,
                        response.status,
                        config.transformResponse);
                }
                if (isSuccess(response.status)) {
                    return response;
                } else {
                    return $q.reject(response);
                }
            }

            return sendReq(config, reqData).then(transformResponse, transformResponse);
        }

        function $http(requestConfig) {
            var config = _.extend({
                method: 'GET',
                transformRequest: defaults.transformRequest,
                transformResponse: defaults.transformResponse,
                paramSerializer: defaults.paramSerializer
            }, requestConfig);
            config.headers = mergeHeaders(requestConfig);

            // return serverRequest(config);
            var promise = $q.when(config);
            _.forEach(interceptors, function(interceptor) {
                promise = promise.then(interceptor.request, interceptor.requestError);
            });
            promise = promise.then(serverRequest);
            _.forEachRight(interceptors, function(interceptor) {
                promise = promise.then(interceptor.response, interceptor.responseError);
            });
            // 扩展辅助方法
            promise.success = function(fn) {
                promise.then(function(response) {
                    fn(response.data, response.status, response.headers, config);
                });
                return promise;
            };
            promise.error = function(fn) {
                promise.catch(function(response) {
                    fn(response.data, response.status, response.headers, config);
                });
                return promise;
            };
            return promise;
        }
        $http.defaults = defaults;
        $http.pendingRequests = [];
        // 扩展工具方法，get访问方法
        // get head delete没有请求数据(request body)
        _.forEach(['get', 'head', 'delete'], function(method) {
            $http[method] = function(url, config) {
                return $http(_.extend(config || {}, {
                    method: method.toUpperCase(),
                    url: url
                }));
            };
        });
        // post put patch有请求数据(request body)
        _.forEach(['post', 'put', 'patch'], function(method) {
            $http[method] = function(url, data, config) {
                return $http(_.extend(config || {}, {
                    method: method.toUpperCase(),
                    url: url,
                    data: data
                }));
            };
        });
        return $http;

        // 工具函数
        function isSuccess(status) {
            return status >= 200 && status < 300;
        }

        function mergeHeaders(config) {
            // return _.extend(
            //     {},
            //     defaults.headers.common,
            //     defaults.headers[(config.method || 'get').toLowerCase()],
            //     config.headers
            // );

            var reqHeaders = _.extend(
                {},
                config.headers
            );
            var defHeaders = _.extend(
                {},
                defaults.headers.common,
                defaults.headers[(config.method || 'get').toLowerCase()]
            );
            _.forEach(defHeaders, function (value, key) {
                var headerExists = _.any(reqHeaders, function (v, k) {
                    return k.toLowerCase() === key.toLowerCase();
                });
                if (!headerExists) {
                    reqHeaders[key] = value;
                }
            });
            // return reqHeaders;
            return executeHeaderFns(reqHeaders, config);
        }

        function executeHeaderFns(headers, config) {
            return _.transform(headers, function (result, v, k) {
                if (_.isFunction(v)) {
                    // result[k] = v(config);
                    v = v(config);
                    if (_.isNull(v) || _.isUndefined(v)) {
                        delete result[k];
                    } else {
                        result[k] = v;
                    }
                }
            }, headers);
        }

        function headersGetter(headers) {
            var headersObj;
            return function (name) {
                headersObj = headersObj || parseHeaders(headers);
                // return headersObj[name.toLowerCase()];
                if (name) {
                    return headersObj[name.toLowerCase()];
                } else {
                    return headersObj;
                }
            };
        }

        function parseHeaders(headers) {
            if (_.isObject(headers)) {
                return _.transform(headers, function (result, v, k) {
                    result[_.trim(k.toLowerCase())] = _.trim(v);
                }, {});
            } else {
                var lines = headers.split('\n');
                return _.transform(lines, function (result, line) {
                    var separatorAt = line.indexOf(':');
                    var name = _.trim(line.substr(0, separatorAt)).toLowerCase();
                    var value = _.trim(line.substr(separatorAt + 1));
                    if (name) {
                        result[name] = value;
                    }
                }, {});
            }
        }

        // 在ajax发送之前对数据进行加工
        function transformData(data, headers, transform) {
            if (_.isFunction(transform)) {
                return transform(data, headers);
            } else {
                // return data;
                // transform里面可以存放多个函数分别对即将发送的请求头做处理
                return _.reduce(transform, function (data, fn) {
                    return fn(data, headers);
                }, data);
            }
        }
    }];
}
function $HttpParamSerializerProvider() {
    this.$get = function() {
        return function serializeParams(params) {
            var parts = [];
            _.forEach(params, function (value, key) {
                if (_.isNull(value) || _.isUndefined(value)) {
                    return;
                }
                // 对于值为数组类型的参数的处理，例如
                // {
                //     a: [22, 33]
                // }
                // 将处理成www.xxx.com?a=22&a=33
                if (!_.isArray(value)) {
                    value = [value];
                }
                _.forEach(value, function (v) {
                    // 对于值为对象类型的参数的处理，直接stringify处理成字符串
                    if (_.isObject(v)) {
                        v = JSON.stringify(v);
                    }
                    // 由于key和value里面可能包含不安全的字符，比如% = ? &这种在url中有特殊意义的符号，因此需要用encodeURIComponent函数进行转义
                    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
                });
            });
            return parts.join('&');
        };
    };
}
function $HttpParamSerializerJQLikeProvider() {
    this.$get = function() {
        return function(params) {
            var parts = [];
            function serialize(value, prefix, topLevel) {
                if (_.isNull(value) || _.isUndefined(value)) {
                    return;
                }
                // 递归处理
                if (_.isArray(value)) {
                    _.forEach(value, function(v, i) {
                        // serialize(v, prefix + '[]');
                        serialize(v, prefix + '[' + (_.isObject(v) ? i : '') + ']');
                    });
                } else if (_.isObject(value) && !_.isDate(value)) {
                    _.forEach(value, function(v, k) {
                        // serialize(v, prefix + '[' + k + ']');
                        serialize(v, prefix +
                            (topLevel ? '' : '[') +
                            k +
                            (topLevel ? '' : ']'));
                    });
                } else {
                    parts.push(
                        encodeURIComponent(prefix) + '=' + encodeURIComponent(value));
                }
            }
            serialize(params, '', true);
            return parts.join('&');
        };
    };
}